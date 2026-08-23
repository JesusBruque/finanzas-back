import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  BankSyncDto,
  CreateAccountDto,
  CreateExpenseDto,
  CreateTransactionDto,
  ImportTransactionsDto,
  UpdateFinanceSettingsDto,
} from './finance.dto';
import { Expense, ExpenseDocument } from './schemas/expense.schema';
import { FinanceSettings, FinanceSettingsDocument } from './schemas/finance-settings.schema';
import { Account, AccountDocument } from './schemas/account.schema';
import { Transaction, TransactionDocument } from './schemas/transaction.schema';
import { SyncHistory, SyncHistoryDocument } from './schemas/sync-history.schema';

const DEFAULT_CATEGORIES = [
  { id: 'cat_001', name: 'Supermercado', type: 'expense', color: '#39b5e0' },
  { id: 'cat_002', name: 'Nomina', type: 'income', color: '#22c55e' },
  { id: 'cat_003', name: 'Internet', type: 'expense', color: '#a78bfa' },
  { id: 'cat_004', name: 'Luz', type: 'expense', color: '#f59e0b' },
] as const;

@Injectable()
export class FinanceService {
  constructor(
    @InjectModel(Account.name)
    private readonly accountModel: Model<AccountDocument>,
    @InjectModel(Expense.name)
    private readonly expenseModel: Model<ExpenseDocument>,
    @InjectModel(FinanceSettings.name)
    private readonly settingsModel: Model<FinanceSettingsDocument>,
    @InjectModel(SyncHistory.name)
    private readonly syncHistoryModel: Model<SyncHistoryDocument>,
    @InjectModel(Transaction.name)
    private readonly transactionModel: Model<TransactionDocument>,
  ) {}

  async getBootstrap() {
    await this.ensureSeedData();

    const settings = await this.getOrCreateSettings();
    const expenses = await this.expenseModel.find().sort({ createdAt: -1 }).lean();

    return {
      settings: this.serializeSettings(settings),
      expenses: expenses.map((expense) => this.serializeExpense(expense)),
    };
  }

  async updateSettings(dto: UpdateFinanceSettingsDto) {
    const settings = await this.settingsModel.findOneAndUpdate(
      { key: 'global' },
      {
        $set: {
          salaryJesus: Number(dto.salaryJesus) || 0,
          salaryAlba: Number(dto.salaryAlba) || 0,
          monthStartDay: Number(dto.monthStartDay) || 1,
          categories: (dto.categories ?? []).map((category) => ({
            name: category.name,
            percentage: Number(category.percentage) || 0,
          })),
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    return this.serializeSettings(settings);
  }

  async createExpense(dto: CreateExpenseDto) {
    const expense = await this.expenseModel.create({
      date: dto.date,
      category: dto.category,
      amount: Number(dto.amount) || 0,
      description: dto.description ?? '',
    });

    return this.serializeExpense(expense.toObject());
  }

  async deleteExpense(id: string) {
    const deleted = await this.expenseModel.findByIdAndDelete(id);
    if (!deleted) {
      throw new NotFoundException('Expense not found');
    }

    return { success: true };
  }

  async getAccounts() {
    await this.ensureSeedData();
    const accounts = await this.accountModel.find().sort({ createdAt: -1 }).lean();
    return accounts.map(({ _id, ...account }) => ({
      ...account,
      id: String(account.id),
    }));
  }

  async createAccount(dto: CreateAccountDto) {
    const payload = {
      id: `acc_${Date.now()}`,
      name: dto.name,
      type: dto.type ?? 'checking',
      balance: Number(dto.balance) || 0,
      currency: dto.currency ?? 'EUR',
      createdAt: new Date().toISOString(),
    };

    const account = await this.accountModel.create(payload);
    const { _id, ...createdAccount } = account.toObject();
    return createdAccount;
  }

  getCategories() {
    return DEFAULT_CATEGORIES.map((category) => ({ ...category }));
  }

  async getTransactions() {
    await this.ensureSeedData();
    const transactions = await this.transactionModel.find().sort({ date: -1, createdAt: -1 }).lean();
    return transactions.map(({ _id, ...transaction }) => ({
      ...transaction,
      id: String(transaction.id),
    }));
  }

  async createTransaction(dto: CreateTransactionDto) {
    await this.ensureSeedData();

    const account = await this.accountModel.findOne({ id: dto.accountId }).lean();
    if (!account) {
      throw new NotFoundException('Account not found');
    }

    const category = DEFAULT_CATEGORIES.find((item) => item.id === dto.categoryId);
    if (!category) {
      throw new NotFoundException('Category not found');
    }

    const amount = Number(dto.amount) || 0;
    const type = dto.type ?? (category.type === 'income' ? 'income' : 'expense');
    const transactionPayload: {
      id: string;
      accountId: string;
      categoryId: string;
      date: string;
      amount: number;
      description: string;
      type: 'income' | 'expense';
      source: 'manual' | 'bank' | 'n8n';
      createdAt: string;
      externalId?: string;
    } = {
      id: `txn_${Date.now()}`,
      accountId: dto.accountId,
      categoryId: dto.categoryId,
      date: dto.date,
      amount,
      description: dto.description ?? '',
      type,
      source: dto.source ?? 'manual',
      createdAt: new Date().toISOString(),
    };

    if (dto.externalId) {
      transactionPayload.externalId = dto.externalId;
    }

    const transaction = await this.transactionModel.create(transactionPayload);

    if (type === 'income') {
      await this.accountModel.updateOne({ id: dto.accountId }, { $inc: { balance: amount } });
    } else {
      await this.accountModel.updateOne({ id: dto.accountId }, { $inc: { balance: -amount } });
    }

    return transaction.toObject();
  }

  async triggerBankSync(dto?: BankSyncDto) {
    const provider = dto?.provider ?? 'open-banking';
    const syncAt = new Date().toISOString();
    const enableBankingState = await this.getEnableBankingState();
    const latestSessionId =
      typeof enableBankingState.latestSessionId === 'string'
        ? enableBankingState.latestSessionId
        : null;
    const record = await this.syncHistoryModel.create({
      id: `sync_${Date.now()}`,
      provider,
      status: 'queued',
      syncAt,
    });
    const { _id, ...createdRecord } = record.toObject();

    if (!latestSessionId) {
      await this.syncHistoryModel.updateOne(
        { id: createdRecord.id },
        { $set: { status: 'error' } },
      );

      return {
        id: createdRecord.id,
        provider,
        status: 'error',
        syncAt: createdRecord.syncAt,
        message: 'No hay sesion bancaria activa. Conecta el banco primero.',
      };
    }

    await this.syncHistoryModel.updateOne(
      { id: createdRecord.id },
      { $set: { status: 'running' } },
    );

    void this.syncTransactionsFromEnableBanking(createdRecord.id, latestSessionId);

    const n8nWebhookUrl = process.env.N8N_SYNC_WEBHOOK_URL;
    if (!n8nWebhookUrl) {
      return {
        id: createdRecord.id,
        provider,
        status: 'running',
        syncAt: createdRecord.syncAt,
        message: 'Sincronización iniciada',
      };
    }

    try {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
      };
      const n8nToken = process.env.N8N_SYNC_WEBHOOK_TOKEN;
      if (n8nToken) {
        headers['x-api-key'] = n8nToken;
      }

      const response = await fetch(n8nWebhookUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          syncId: createdRecord.id,
          provider,
          requestedAt: syncAt,
          enableBanking: {
            sessionId: latestSessionId,
          },
        }),
      });

      if (!response.ok) {
        return {
          id: createdRecord.id,
          provider,
          status: 'running',
          syncAt: createdRecord.syncAt,
          message: `Sincronización iniciada (n8n devolvio ${response.status})`,
        };
      }

      return {
        id: createdRecord.id,
        provider,
        status: 'running',
        syncAt: createdRecord.syncAt,
        message: 'Sincronización enviada a n8n',
      };
    } catch {
      return {
        id: createdRecord.id,
        provider,
        status: 'running',
        syncAt: createdRecord.syncAt,
        message: 'Sincronización iniciada (n8n no disponible)',
      };
    }
  }

  private async syncTransactionsFromEnableBanking(syncId: string, sessionId: string): Promise<void> {
    try {
      const result = await this.pullEnableBankingTransactions(sessionId);
      await this.updateEnableBankingState({
        lastSyncResult: {
          syncId,
          at: new Date().toISOString(),
          status: result.imported > 0 ? 'success' : 'error',
          accountCount: result.accountCount,
          fetchedCount: result.fetchedCount,
          imported: result.imported,
          skipped: result.skipped,
        },
      });

      if (result.imported === 0) {
        await this.syncHistoryModel.updateOne(
          { id: syncId },
          { $set: { status: 'error' } },
        );
        return;
      }

      await this.syncHistoryModel.updateOne(
        { id: syncId },
        { $set: { status: 'success' } },
      );
    } catch (error) {
      await this.updateEnableBankingState({
        lastSyncResult: {
          syncId,
          at: new Date().toISOString(),
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown sync error',
        },
      });
      await this.syncHistoryModel.updateOne(
        { id: syncId },
        { $set: { status: 'error' } },
      );
    }
  }

  private async pullEnableBankingTransactions(sessionId: string): Promise<{ imported: number; skipped: number; accountCount: number; fetchedCount: number }> {
    const appId = process.env.ENABLE_BANKING_APP_ID;
    const privateKeyPem = this.getEnableBankingPrivateKeyPem();
    if (!appId || !privateKeyPem) {
      throw new Error('Enable Banking credentials missing for sync');
    }

    const jwt = this.createEnableBankingJwt(appId, privateKeyPem);
    const accountIds = await this.fetchEnableBankingAccountIds(sessionId, jwt);
    if (accountIds.length === 0) {
      throw new Error('No bank accounts found for authorized session');
    }

    const accounts = await this.getAccounts();
    const defaultAccountId = accounts[0]?.id ?? 'acc_001';
    const transactions: CreateTransactionDto[] = [];

    for (const accountId of accountIds) {
      const payload = await this.fetchEnableBankingAccountTransactions(accountId, jwt);
      const rawEntries = this.extractEnableBankingTransactionEntries(payload);

      for (const rawEntry of rawEntries) {
        const mapped = this.mapEnableBankingEntryToTransaction(rawEntry, {
          fallbackAccountId: defaultAccountId,
          sourceAccountId: accountId,
          sessionId,
        });

        if (mapped) {
          transactions.push(mapped);
        }
      }
    }

    if (transactions.length === 0) {
      throw new Error('No transactions returned by provider for connected accounts');
    }

    const imported = await this.importTransactions({
      source: 'bank',
      transactions,
    });

    return {
      imported: imported.imported,
      skipped: imported.skipped ?? 0,
      accountCount: accountIds.length,
      fetchedCount: transactions.length,
    };
  }

  private async fetchEnableBankingAccountIds(sessionId: string, jwt: string): Promise<string[]> {
    const candidates = [
      `https://api.enablebanking.com/sessions/${sessionId}/accounts`,
      `https://api.enablebanking.com/accounts?session_id=${encodeURIComponent(sessionId)}`,
      `https://api.enablebanking.com/accounts?session=${encodeURIComponent(sessionId)}`,
      `https://api.enablebanking.com/sessions/${sessionId}`,
    ];

    for (const url of candidates) {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        continue;
      }

      const bodyText = await response.text();
      const parsed = this.safeParseJson(bodyText);
      const accountIds = this.extractEnableBankingAccountIds(parsed);
      if (accountIds.length > 0) {
        return accountIds;
      }
    }

    return [];
  }

  private extractEnableBankingAccountIds(payload: Record<string, unknown> | null): string[] {
    if (!payload) {
      return [];
    }

    const accountLists = [
      payload.accounts,
      payload.data,
      (payload.session as Record<string, unknown> | undefined)?.accounts,
    ];

    const ids: string[] = [];
    for (const list of accountLists) {
      if (!Array.isArray(list)) {
        continue;
      }

      for (const item of list) {
        if (typeof item === 'string' && item.length > 0) {
          ids.push(item);
          continue;
        }

        if (!item || typeof item !== 'object') {
          continue;
        }

        const account = item as Record<string, unknown>;
        const candidate = [
          account.id,
          account.accountId,
          account.account_id,
          account.uid,
          account.uuid,
          account.resourceId,
          account.resource_id,
        ]
          .find((value): value is string => typeof value === 'string' && value.length > 0);

        if (candidate) {
          ids.push(candidate);
        }
      }
    }

    return [...new Set(ids)];
  }

  private async fetchEnableBankingAccountTransactions(accountId: string, jwt: string): Promise<Record<string, unknown> | null> {
    const state = await this.getEnableBankingState();
    const sessionId = typeof state.latestSessionId === 'string' ? state.latestSessionId : null;
    const today = new Date();
    const dateFrom = new Date(today);
    dateFrom.setFullYear(today.getFullYear() - 1);
    const dateFromIso = dateFrom.toISOString().slice(0, 10);
    const dateToIso = today.toISOString().slice(0, 10);

    const candidates = [
      `https://api.enablebanking.com/accounts/${accountId}/transactions`,
      `https://api.enablebanking.com/accounts/${accountId}/transactions?booking_status=booked`,
      `https://api.enablebanking.com/accounts/${accountId}/transactions?date_from=${dateFromIso}&date_to=${dateToIso}`,
      `https://api.enablebanking.com/accounts/${accountId}/transactions?booking_status=booked&date_from=${dateFromIso}&date_to=${dateToIso}`,
      ...(sessionId
        ? [
            `https://api.enablebanking.com/sessions/${sessionId}/accounts/${accountId}/transactions`,
            `https://api.enablebanking.com/sessions/${sessionId}/accounts/${accountId}/transactions?booking_status=booked`,
            `https://api.enablebanking.com/sessions/${sessionId}/accounts/${accountId}/transactions?date_from=${dateFromIso}&date_to=${dateToIso}`,
          ]
        : []),
    ];

    for (const url of candidates) {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        continue;
      }

      const bodyText = await response.text();
      const parsed = this.safeParseJson(bodyText);
      if (parsed) {
        return parsed;
      }
    }

    return null;
  }

  private extractEnableBankingTransactionEntries(payload: Record<string, unknown> | null): Record<string, unknown>[] {
    if (!payload) {
      return [];
    }

    const transactionsNode = payload.transactions as Record<string, unknown> | undefined;
    const candidates = [
      payload.booked,
      payload.pending,
      payload.data,
      payload.items,
      payload.results,
      payload.transactions,
      transactionsNode?.booked,
      transactionsNode?.pending,
      transactionsNode?.items,
      transactionsNode?.results,
      transactionsNode?.transactions,
    ];

    const entries: Record<string, unknown>[] = [];
    for (const candidate of candidates) {
      if (!Array.isArray(candidate)) {
        continue;
      }

      for (const item of candidate) {
        if (item && typeof item === 'object') {
          entries.push(item as Record<string, unknown>);
        }
      }
    }

    return entries;
  }

  private mapEnableBankingEntryToTransaction(
    entry: Record<string, unknown>,
    context: { fallbackAccountId: string; sourceAccountId: string; sessionId: string },
  ): CreateTransactionDto | null {
    const amountInfo = (entry.transactionAmount as Record<string, unknown> | undefined)
      ?? (entry.transaction_amount as Record<string, unknown> | undefined)
      ?? (entry.amount as Record<string, unknown> | undefined);
    const rawAmount = amountInfo?.amount ?? entry.amount;
    const numericAmount = Number(String(rawAmount).replace(',', '.'));
    if (!Number.isFinite(numericAmount) || numericAmount === 0) {
      return null;
    }

    const indicator = String(entry.creditDebitIndicator ?? entry.credit_debit_indicator ?? '').toUpperCase();
    const isIncome = indicator === 'CRDT' || numericAmount > 0;
    const type: 'income' | 'expense' = isIncome ? 'income' : 'expense';
    const amount = Math.abs(numericAmount);

    const dateCandidate = [
      entry.bookingDate,
      entry.valueDate,
      entry.date,
      entry.booking_date,
      entry.value_date,
      entry.transaction_date,
    ].find((value): value is string => typeof value === 'string' && value.length >= 10);
    const date = (dateCandidate ?? new Date().toISOString()).slice(0, 10);

    const remittance = Array.isArray(entry.remittance_information)
      ? (entry.remittance_information.find((value): value is string => typeof value === 'string' && value.trim().length > 0) ?? null)
      : null;

    const descriptionCandidate = [
      entry.remittanceInformationUnstructured,
      entry.remittanceInformationStructured,
      entry.additionalInformation,
      remittance,
      entry.reference_number,
      (entry.creditor as Record<string, unknown> | undefined)?.name,
      (entry.debtor as Record<string, unknown> | undefined)?.name,
      entry.creditorName,
      entry.debtorName,
      entry.description,
    ].find((value): value is string => typeof value === 'string' && value.trim().length > 0);

    const externalIdCandidate = [
      entry.transactionId,
      entry.internalTransactionId,
      entry.id,
      entry.entryReference,
      entry.entry_reference,
      entry.reference_number,
      entry.transaction_id,
      entry.reference,
      entry.uid,
    ].find((value): value is string => typeof value === 'string' && value.length > 0);

    const externalId = externalIdCandidate
      ? `${context.sessionId}:${context.sourceAccountId}:${externalIdCandidate}`
      : `${context.sessionId}:${context.sourceAccountId}:${date}:${amount}:${type}`;

    return {
      accountId: context.fallbackAccountId,
      categoryId: type === 'income' ? 'cat_002' : 'cat_001',
      date,
      amount,
      description: descriptionCandidate ?? 'Movimiento Open Banking',
      type,
      source: 'bank',
      externalId,
    };
  }

  async importTransactions(dto?: ImportTransactionsDto, apiKey?: string) {
    const ingestApiKey = process.env.BANK_INGEST_API_KEY;
    if (ingestApiKey && apiKey !== ingestApiKey) {
      throw new UnauthorizedException('Invalid import API key');
    }

    const source = dto?.source ?? 'n8n';
    const items = dto?.transactions ?? [];
    let imported = 0;
    let skipped = 0;

    for (const transactionDto of items) {
      const externalId = transactionDto.externalId?.trim();
      if (externalId) {
        const existing = await this.transactionModel.findOne({
          source: transactionDto.source ?? source,
          externalId,
        });
        if (existing) {
          skipped += 1;
          continue;
        }
      }

      await this.createTransaction({
        ...transactionDto,
        type: transactionDto.type ?? 'expense',
        source: transactionDto.source ?? source,
        externalId,
      });
      imported += 1;
    }

    return {
      imported,
      skipped,
      source,
    };
  }

  async getSyncHistory() {
    const history = await this.syncHistoryModel.find().sort({ syncAt: -1 }).lean();
    return history.map(({ _id, ...entry }) => ({
      ...entry,
      id: String(entry.id),
    }));
  }

  async getEnableBankingTargetBanks() {
    const appId = process.env.ENABLE_BANKING_APP_ID;
    const privateKeyPem = this.getEnableBankingPrivateKeyPem();
    const country = process.env.ENABLE_BANKING_COUNTRY || 'ES';
    const targets = (process.env.ENABLE_BANKING_TARGET_BANKS || 'Unicaja,Caja Rural del Sur,Bankinter')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    if (!appId || !privateKeyPem) {
      return {
        country,
        totalAspsps: 0,
        allTargetsFound: false,
        targets: targets.map((target) => ({ target, found: false, matches: [] as string[] })),
        sampleAspsps: [] as string[],
        error: 'Enable Banking is not configured in backend environment',
      };
    }

    const jwt = this.createEnableBankingJwt(appId, privateKeyPem);

    const response = await fetch(`https://api.enablebanking.com/aspsps?country=${country}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/json',
      },
    });

    const bodyText = await response.text();
    if (!response.ok) {
      return {
        country,
        totalAspsps: 0,
        allTargetsFound: false,
        targets: targets.map((target) => ({ target, found: false, matches: [] as string[] })),
        sampleAspsps: [] as string[],
        error: `Enable Banking request failed with ${response.status}`,
        response: bodyText,
      };
    }

    const data = JSON.parse(bodyText) as { aspsps?: Array<{ name?: string }> };
    const names = (data.aspsps ?? []).map((item) => item?.name).filter((name): name is string => Boolean(name));
    const results = targets.map((target) => {
      const matcher = this.buildTargetMatcher(target);
      const matches = names.filter(matcher);
      return {
        target,
        found: matches.length > 0,
        matches,
      };
    });

    return {
      country,
      totalAspsps: names.length,
      allTargetsFound: results.every((item) => item.found),
      targets: results,
      sampleAspsps: names.slice(0, 20),
    };
  }

  async getEnableBankingConnectUrl() {
    const appId = process.env.ENABLE_BANKING_APP_ID;
    const redirectCandidates = this.getEnableBankingRedirectUrlCandidates();
    const privateKeyPem = this.getEnableBankingPrivateKeyPem();
    const country = process.env.ENABLE_BANKING_COUNTRY || 'ES';
    const targetBank = (process.env.ENABLE_BANKING_TARGET_BANKS || 'Bankinter')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)[0] || 'Bankinter';

    if (!appId || redirectCandidates.length === 0 || !privateKeyPem) {
      return {
        configured: false,
        error: 'Missing ENABLE_BANKING_APP_ID, ENABLE_BANKING_PRIVATE_KEY_PEM/PATH or ENABLE_BANKING_REDIRECT_URL',
      };
    }

    const state = crypto.randomUUID();
    await this.updateEnableBankingState({
      pendingState: state,
      pendingStateCreatedAt: new Date().toISOString(),
      lastExchangeError: null,
    });

    const jwt = this.createEnableBankingJwt(appId, privateKeyPem);
    let resolvedAuthUrl: string | null = null;
    let selectedRedirectUrl: string | null = null;
    let lastStatus = 0;
    let lastErrorDetail = '';

    for (const redirectUrl of redirectCandidates) {
      const attempt = await this.requestEnableBankingConnectUrl({
        appId,
        jwt,
        country,
        targetBank,
        redirectUrl,
        state,
      });

      if (attempt.authUrl) {
        resolvedAuthUrl = attempt.authUrl;
        selectedRedirectUrl = redirectUrl;
        break;
      }

      lastStatus = attempt.status;
      lastErrorDetail = attempt.errorDetail;
    }

    if (!resolvedAuthUrl || !selectedRedirectUrl) {
      return {
        configured: false,
        error: `Enable Banking connect URL request failed (${lastStatus || 'unknown'})`,
        response: lastErrorDetail || 'No auth URL returned by provider',
      };
    }

    await this.updateEnableBankingState({ pendingRedirectUrl: selectedRedirectUrl });

    return {
      configured: true,
      authUrl: resolvedAuthUrl,
      state,
      redirectUrl: selectedRedirectUrl,
      country,
      bank: targetBank,
    };
  }

  async handleEnableBankingCallback(input: {
    code?: string;
    state?: string;
    error?: string;
    errorDescription?: string;
  }) {
    const receivedAt = new Date().toISOString();
    const existingState = await this.getEnableBankingState();
    const stateMatches = Boolean(
      input.state &&
      typeof existingState.pendingState === 'string' &&
      input.state === existingState.pendingState,
    );

    let sessionId: string | null = null;
    let exchangeResponse: Record<string, unknown> | string | null = null;
    let exchangeError: string | null = null;

    if (input.code) {
      try {
        const exchanged = await this.exchangeEnableBankingCode(input.code, input.state);
        sessionId = exchanged.sessionId;
        exchangeResponse = exchanged.raw;
      } catch (error) {
        exchangeError = error instanceof Error ? error.message : 'Unknown exchange error';
      }
    }

    const patch: Record<string, unknown> = {
      pendingState: null,
      pendingStateCreatedAt: null,
      lastCallbackAt: receivedAt,
      lastCallback: {
        codePresent: Boolean(input.code),
        state: input.state ?? null,
        error: input.error ?? null,
        errorDescription: input.errorDescription ?? null,
      },
      stateMatches,
      lastExchangeError: exchangeError,
      lastExchangeResponse: exchangeResponse,
    };

    if (sessionId) {
      patch.latestSessionId = sessionId;
      patch.latestSessionAt = receivedAt;
    }

    const savedState = await this.updateEnableBankingState(patch);

    return {
      ok: !input.error && !exchangeError,
      receivedAt,
      stateMatches,
      sessionId,
      callbackError: input.error ?? null,
      callbackErrorDescription: input.errorDescription ?? null,
      exchangeError,
      next: '/api/enablebanking/session-status',
      stored: {
        latestSessionId: savedState.latestSessionId ?? null,
        latestSessionAt: savedState.latestSessionAt ?? null,
      },
    };
  }

  async getEnableBankingSessionStatus() {
    const state = await this.getEnableBankingState();
    return {
      latestSessionId: typeof state.latestSessionId === 'string' ? state.latestSessionId : null,
      latestSessionAt: typeof state.latestSessionAt === 'string' ? state.latestSessionAt : null,
      pendingStateCreatedAt:
        typeof state.pendingStateCreatedAt === 'string' ? state.pendingStateCreatedAt : null,
      hasPendingState: Boolean(state.pendingState),
      stateMatches: state.stateMatches === true,
      lastExchangeError:
        typeof state.lastExchangeError === 'string' ? state.lastExchangeError : null,
      lastCallbackAt: typeof state.lastCallbackAt === 'string' ? state.lastCallbackAt : null,
      lastCallback: (state.lastCallback as Record<string, unknown> | undefined) ?? null,
      lastSyncResult: (state.lastSyncResult as Record<string, unknown> | undefined) ?? null,
    };
  }

  async debugEnableBankingPull() {
    const state = await this.getEnableBankingState();
    const sessionId = typeof state.latestSessionId === 'string' ? state.latestSessionId : null;

    if (!sessionId) {
      return {
        ok: false,
        error: 'No active session id',
      };
    }

    const appId = process.env.ENABLE_BANKING_APP_ID;
    const privateKeyPem = this.getEnableBankingPrivateKeyPem();
    if (!appId || !privateKeyPem) {
      return {
        ok: false,
        error: 'Missing Enable Banking credentials',
      };
    }

    const jwt = this.createEnableBankingJwt(appId, privateKeyPem);
    const probes = await this.probeEnableBankingSessionEndpoints(sessionId, jwt);
    const accountIds = await this.fetchEnableBankingAccountIds(sessionId, jwt);
    const perAccount: Array<{ accountId: string; transactionCount: number; sample: Record<string, unknown> | null }> = [];
    let totalTransactions = 0;

    for (const accountId of accountIds) {
      const payload = await this.fetchEnableBankingAccountTransactions(accountId, jwt);
      const entries = this.extractEnableBankingTransactionEntries(payload);
      totalTransactions += entries.length;
      perAccount.push({
        accountId,
        transactionCount: entries.length,
        sample: entries[0] ?? null,
      });
    }

    return {
      ok: true,
      sessionId,
      accountCount: accountIds.length,
      totalTransactions,
      perAccount,
      probes,
    };
  }

  private async probeEnableBankingSessionEndpoints(sessionId: string, jwt: string): Promise<Array<{
    url: string;
    status: number;
    hasJson: boolean;
    keys: string[];
    preview: string;
  }>> {
    const urls = [
      `https://api.enablebanking.com/sessions/${sessionId}`,
      `https://api.enablebanking.com/sessions/${sessionId}/accounts`,
      `https://api.enablebanking.com/accounts?session_id=${encodeURIComponent(sessionId)}`,
      `https://api.enablebanking.com/accounts?session=${encodeURIComponent(sessionId)}`,
    ];

    const results: Array<{
      url: string;
      status: number;
      hasJson: boolean;
      keys: string[];
      preview: string;
    }> = [];

    for (const url of urls) {
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${jwt}`,
            Accept: 'application/json',
          },
        });

        const bodyText = await response.text();
        const parsed = this.safeParseJson(bodyText);
        results.push({
          url,
          status: response.status,
          hasJson: Boolean(parsed),
          keys: parsed ? Object.keys(parsed) : [],
          preview: bodyText.slice(0, 400),
        });
      } catch (error) {
        results.push({
          url,
          status: 0,
          hasJson: false,
          keys: [],
          preview: error instanceof Error ? error.message : 'request failed',
        });
      }
    }

    return results;
  }

  async getDashboard(month?: string, categoryId?: string) {
    const monthFilter = month || new Date().toISOString().slice(0, 7);
    const transactions = await this.getTransactions();
    const filteredByMonth = transactions.filter((transaction) => transaction.date.startsWith(monthFilter));
    const filteredTransactions = categoryId && categoryId !== 'all'
      ? filteredByMonth.filter((transaction) => transaction.categoryId === categoryId)
      : filteredByMonth;

    const totalIncome = filteredTransactions
      .filter((transaction) => transaction.type === 'income')
      .reduce((sum, transaction) => sum + Number(transaction.amount), 0);
    const totalExpense = filteredTransactions
      .filter((transaction) => transaction.type === 'expense')
      .reduce((sum, transaction) => sum + Number(transaction.amount), 0);

    return {
      totalIncome,
      totalExpense,
      balance: totalIncome - totalExpense,
      monthlyTransactions: filteredTransactions.length,
    };
  }

  async getBudgetPlan() {
    await this.ensureSeedData();
    const settings = await this.getOrCreateSettings();
    const currentMonth = new Date().toISOString().slice(0, 7);
    const transactions = await this.transactionModel.find({ date: { $regex: `^${currentMonth}` } }).lean();
    const totalIncome = transactions
      .filter((transaction) => transaction.type === 'income')
      .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);

    const categoryDefinitions = settings.categories?.length
      ? settings.categories.map((category) => ({
          name: category.name,
          type: this.inferCategoryType(category.name),
          percentage: Number(category.percentage) || 0,
        }))
      : [
          { name: 'Nomina', type: 'income', percentage: 100 },
          { name: 'Supermercado', type: 'expense', percentage: 30 },
          { name: 'Internet', type: 'expense', percentage: 12 },
          { name: 'Luz', type: 'expense', percentage: 10 },
        ];

    const categoryNameMap: Record<string, string> = Object.fromEntries(
      DEFAULT_CATEGORIES.map((category) => [category.id, category.name]),
    ) as Record<string, string>;

    return categoryDefinitions.map((definition) => {
      const spent = transactions
        .filter((transaction) => (categoryNameMap[transaction.categoryId] ?? '') === definition.name)
        .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);

      const planned = definition.type === 'income'
        ? totalIncome
        : totalIncome > 0
          ? (totalIncome * definition.percentage) / 100
          : 0;
      const remaining = planned - spent;

      return {
        category: definition.name,
        type: definition.type,
        planned: Number(planned.toFixed(2)),
        spent: Number(spent.toFixed(2)),
        remaining: Number(remaining.toFixed(2)),
      };
    });
  }

  async getBudgetAlerts() {
    const budgetPlan = await this.getBudgetPlan();

    return budgetPlan
      .filter((item) => item.type === 'expense')
      .map((item) => {
        const ratio = item.planned > 0 ? item.spent / item.planned : 0;
        let status: 'ok' | 'warning' | 'critical' = 'ok';

        if (ratio >= 0.9) {
          status = 'critical';
        } else if (ratio >= 0.7) {
          status = 'warning';
        }

        return {
          category: item.category,
          status,
          spent: item.spent,
          planned: item.planned,
          remaining: item.remaining,
        };
      });
  }

  private inferCategoryType(categoryName: string): 'income' | 'expense' {
    const normalized = categoryName.toLowerCase();
    if (normalized.includes('nomina') || normalized.includes('salary') || normalized.includes('ingreso')) {
      return 'income';
    }
    return 'expense';
  }

  private createEnableBankingJwt(appId: string, privateKeyPem: string): string {
    const iat = Math.floor(Date.now() / 1000);
    const header = {
      alg: 'RS256',
      typ: 'JWT',
      kid: appId,
    };
    const payload = {
      iss: 'enablebanking.com',
      aud: 'api.enablebanking.com',
      iat,
      exp: iat + 3600,
    };

    const encodedHeader = this.b64url(JSON.stringify(header));
    const encodedPayload = this.b64url(JSON.stringify(payload));
    const unsignedToken = `${encodedHeader}.${encodedPayload}`;

    const signer = crypto.createSign('RSA-SHA256');
    signer.update(unsignedToken);
    signer.end();
    const signature = signer.sign(privateKeyPem);

    return `${unsignedToken}.${this.b64url(signature)}`;
  }

  private async exchangeEnableBankingCode(code: string, state?: string): Promise<{
    sessionId: string | null;
    raw: Record<string, unknown> | string;
  }> {
    const appId = process.env.ENABLE_BANKING_APP_ID;
    const existingState = await this.getEnableBankingState();
    const stateRedirectUrl = existingState.pendingRedirectUrl;
    const redirectUrl =
      typeof stateRedirectUrl === 'string' && stateRedirectUrl.length > 0
        ? stateRedirectUrl
        : this.getEnableBankingRedirectUrl();
    const privateKeyPem = this.getEnableBankingPrivateKeyPem();

    if (!appId || !redirectUrl || !privateKeyPem) {
      throw new Error('Missing Enable Banking app configuration for session exchange');
    }

    const jwt = this.createEnableBankingJwt(appId, privateKeyPem);
    const response = await fetch('https://api.enablebanking.com/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        code,
        state,
        redirect_url: redirectUrl,
      }),
    });

    const bodyText = await response.text();
    const parsed = this.safeParseJson(bodyText);

    if (!response.ok) {
      const detail = parsed ? JSON.stringify(parsed) : bodyText;
      throw new Error(`Enable Banking session exchange failed (${response.status}): ${detail}`);
    }

    const raw = parsed ?? bodyText;
    const sessionId = this.extractSessionId(parsed);
    return { sessionId, raw };
  }

  private extractSessionId(payload: Record<string, unknown> | null): string | null {
    if (!payload) {
      return null;
    }

    const fromSession = payload.session as Record<string, unknown> | undefined;
    const candidates = [
      payload.id,
      payload.sessionId,
      payload.session_id,
      fromSession?.id,
      fromSession?.sessionId,
      fromSession?.session_id,
    ];

    const found = candidates.find((value): value is string => typeof value === 'string' && value.length > 0);
    return found ?? null;
  }

  private safeParseJson(input: string): Record<string, unknown> | null {
    try {
      return JSON.parse(input) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private getEnableBankingPrivateKeyPem(): string | null {
    const keyFromEnv = process.env.ENABLE_BANKING_PRIVATE_KEY_PEM?.trim();
    if (keyFromEnv) {
      // Support multiline PEM stored as escaped newlines in environment variables.
      return keyFromEnv.replace(/\\n/g, '\n');
    }

    const keyPath = process.env.ENABLE_BANKING_PRIVATE_KEY_PATH;
    if (keyPath && fs.existsSync(keyPath)) {
      return fs.readFileSync(keyPath, 'utf8');
    }

    return null;
  }

  private getEnableBankingRedirectUrl(): string | null {
    const fromEnv = process.env.ENABLE_BANKING_REDIRECT_URL?.trim();
    if (fromEnv) {
      return fromEnv;
    }

    // Safe production fallback when Render env is temporarily missing.
    return 'https://finanzas-back-yzbs.onrender.com/api/enablebanking/callback';
  }

  private getEnableBankingRedirectUrlCandidates(): string[] {
    const candidates = [
      process.env.ENABLE_BANKING_REDIRECT_URL?.trim() ?? '',
      'https://finanzas-back-yzbs.onrender.com/api/enablebanking/callback',
      'https://finanzas-back-yzbs.onrender.com/api/enable-banking/callback',
    ].filter((value) => value.length > 0);

    return [...new Set(candidates)];
  }

  private async requestEnableBankingConnectUrl(input: {
    appId: string;
    jwt: string;
    country: string;
    targetBank: string;
    redirectUrl: string;
    state: string;
  }): Promise<{ authUrl: string | null; status: number; errorDetail: string }> {
    const validUntil = new Date(Date.now() + 1000 * 60 * 60 * 24 * 90).toISOString();
    let upstreamResponse = await fetch('https://api.enablebanking.com/auth', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.jwt}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        access: {
          balances: true,
          transactions: true,
          valid_until: validUntil,
        },
        aspsp: {
          country: input.country,
          name: input.targetBank,
        },
        psu_type: 'personal',
        redirect_url: input.redirectUrl,
        state: input.state,
      }),
    });

    if (upstreamResponse.status === 405) {
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: input.appId,
        redirect_uri: input.redirectUrl,
        state: input.state,
        country: input.country,
      });

      upstreamResponse = await fetch(`https://api.enablebanking.com/auth?${params.toString()}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${input.jwt}`,
          Accept: 'application/json',
        },
        redirect: 'manual',
      });
    }

    const locationHeader = upstreamResponse.headers.get('location');
    const bodyText = await upstreamResponse.text();
    const parsedBody = this.safeParseJson(bodyText);
    const resolvedAuthUrl = [
      locationHeader,
      parsedBody?.url,
      parsedBody?.authUrl,
      parsedBody?.auth_url,
      parsedBody?.authorizationUrl,
    ].find((value): value is string => typeof value === 'string' && value.startsWith('http')) ?? null;

    return {
      authUrl: resolvedAuthUrl,
      status: upstreamResponse.status,
      errorDetail: parsedBody ? JSON.stringify(parsedBody) : bodyText,
    };
  }

  private async getEnableBankingState(): Promise<Record<string, unknown>> {
    const settings = await this.getOrCreateSettings();
    const integrationState = (settings.integrationState ?? {}) as Record<string, unknown>;
    const enableBanking = integrationState.enableBanking;

    if (enableBanking && typeof enableBanking === 'object' && !Array.isArray(enableBanking)) {
      return enableBanking as Record<string, unknown>;
    }

    return {};
  }

  private async updateEnableBankingState(
    patch: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const settings = await this.getOrCreateSettings();
    const integrationState = (settings.integrationState ?? {}) as Record<string, unknown>;
    const currentEnableBanking = integrationState.enableBanking;
    const currentState =
      currentEnableBanking &&
      typeof currentEnableBanking === 'object' &&
      !Array.isArray(currentEnableBanking)
        ? (currentEnableBanking as Record<string, unknown>)
        : {};

    const nextEnableBankingState = {
      ...currentState,
      ...patch,
    };

    await this.settingsModel.updateOne(
      { key: 'global' },
      {
        $set: {
          integrationState: {
            ...integrationState,
            enableBanking: nextEnableBankingState,
          },
        },
      },
      { upsert: true },
    );

    return nextEnableBankingState;
  }

  private b64url(input: string | Buffer): string {
    return Buffer.from(input)
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  }

  private normalizeBankName(value: string): string {
    return (value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  private buildTargetMatcher(target: string): (candidate: string) => boolean {
    const tokens = this.normalizeBankName(target).split(' ').filter(Boolean);
    return (candidate: string) => {
      const normalizedCandidate = this.normalizeBankName(candidate);
      return tokens.every((token) => normalizedCandidate.includes(token));
    };
  }

  private async ensureSeedData() {
    const accountCount = await this.accountModel.countDocuments();
    if (accountCount === 0) {
      await this.accountModel.create({
        id: 'acc_001',
        name: 'Cuenta principal',
        type: 'checking',
        balance: 2450.75,
        currency: 'EUR',
        createdAt: '2026-08-22T10:00:00.000Z',
      });
    }

    const transactionCount = await this.transactionModel.countDocuments();
    if (transactionCount === 0) {
      await this.transactionModel.insertMany([
        {
          id: 'txn_001',
          accountId: 'acc_001',
          categoryId: 'cat_001',
          date: '2026-08-20',
          amount: 84.5,
          description: 'Compra supermercado',
          type: 'expense',
          source: 'manual',
          createdAt: '2026-08-22T08:14:00.000Z',
        },
        {
          id: 'txn_002',
          accountId: 'acc_001',
          categoryId: 'cat_002',
          date: '2026-08-01',
          amount: 2200,
          description: 'Nomina',
          type: 'income',
          source: 'manual',
          createdAt: '2026-08-02T09:00:00.000Z',
        },
        {
          id: 'txn_003',
          accountId: 'acc_001',
          categoryId: 'cat_003',
          date: '2026-08-12',
          amount: 50,
          description: 'Internet',
          type: 'expense',
          source: 'manual',
          createdAt: '2026-08-12T10:00:00.000Z',
        },
        {
          id: 'txn_004',
          accountId: 'acc_001',
          categoryId: 'cat_004',
          date: '2026-08-15',
          amount: 50,
          description: 'Luz',
          type: 'expense',
          source: 'manual',
          createdAt: '2026-08-15T12:00:00.000Z',
        },
      ]);
    }

    const syncHistoryCount = await this.syncHistoryModel.countDocuments();
    if (syncHistoryCount === 0) {
      await this.syncHistoryModel.create({
        id: 'sync_001',
        provider: 'open-banking',
        status: 'success',
        syncAt: '2026-08-22T10:00:00.000Z',
      });
    }

    await this.getOrCreateSettings();
  }

  private async getOrCreateSettings() {
    const existing = await this.settingsModel.findOne({ key: 'global' });
    if (existing) {
      return existing;
    }

    return this.settingsModel.create({
      key: 'global',
      salaryJesus: 0,
      salaryAlba: 0,
      monthStartDay: 1,
      integrationState: {},
      categories: [
        { name: 'Nomina', percentage: 100 },
        { name: 'Supermercado', percentage: 30 },
        { name: 'Internet', percentage: 12 },
        { name: 'Luz', percentage: 10 },
      ],
    });
  }

  private serializeSettings(settings: FinanceSettingsDocument | (FinanceSettings & { _id?: unknown })) {
    return {
      salaryJesus: settings.salaryJesus ?? 0,
      salaryAlba: settings.salaryAlba ?? 0,
      monthStartDay: settings.monthStartDay ?? 1,
      categories: settings.categories ?? [],
    };
  }

  private serializeExpense(expense: Partial<Expense> & { _id?: unknown }) {
    return {
      id: String(expense._id),
      date: expense.date ?? '',
      category: expense.category ?? '',
      amount: expense.amount ?? 0,
      description: expense.description ?? '',
    };
  }
}
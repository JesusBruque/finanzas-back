import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {
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
    await this.ensureSettingsInitialized();

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
    await this.ensureSettingsInitialized();
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
    await this.ensureSettingsInitialized();
    const transactions = await this.transactionModel.find().sort({ date: -1, createdAt: -1 }).lean();
    return transactions.map(({ _id, ...transaction }) => ({
      ...transaction,
      id: String(transaction.id),
    }));
  }

  async createTransaction(dto: CreateTransactionDto) {
    await this.ensureSettingsInitialized();

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

  async triggerBankSync() {
    const connections = await this.ensureEnableBankingConnections();
    const connected = connections.filter(
      (connection) => connection.status === 'connected' && typeof connection.sessionId === 'string' && connection.sessionId,
    );
    const syncAt = new Date().toISOString();

    if (connected.length === 0) {
      return {
        status: 'error' as const,
        syncAt,
        message: 'No hay ningún banco conectado todavía. Conecta al menos uno primero.',
        banks: [] as string[],
      };
    }

    for (const connection of connected) {
      const bankKey = String(connection.bankKey);
      const record = await this.syncHistoryModel.create({
        id: `sync_${Date.now()}_${bankKey}`,
        provider: String(connection.bankName),
        status: 'running',
        syncAt,
      });

      void this.runBankSync(bankKey, record.id);
    }

    return {
      status: 'running' as const,
      syncAt,
      message: `Sincronización iniciada para ${connected.length} banco(s)`,
      banks: connected.map((connection) => String(connection.bankName)),
    };
  }

  async triggerScheduledBankSync(apiKey?: string) {
    const ingestApiKey = process.env.BANK_INGEST_API_KEY;
    if (ingestApiKey && apiKey !== ingestApiKey) {
      throw new UnauthorizedException('Invalid sync API key');
    }

    return this.triggerBankSync();
  }

  private async runBankSync(bankKey: string, syncHistoryId: string): Promise<void> {
    try {
      const result = await this.pullEnableBankingTransactionsForBank(bankKey);
      await this.updateEnableBankingConnection(bankKey, {
        lastSyncAt: new Date().toISOString(),
        lastSyncStatus: 'success',
        lastSyncImported: result.imported,
        lastSyncSkipped: result.skipped,
        lastSyncError: null,
        accountCount: result.accountCount,
      });

      await this.syncHistoryModel.updateOne({ id: syncHistoryId }, { $set: { status: 'success' } });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown sync error';
      await this.updateEnableBankingConnection(bankKey, {
        lastSyncAt: new Date().toISOString(),
        lastSyncStatus: 'error',
        lastSyncError: message,
      });

      await this.syncHistoryModel.updateOne({ id: syncHistoryId }, { $set: { status: 'error' } });
    }
  }

  private async pullEnableBankingTransactionsForBank(bankKey: string): Promise<{ imported: number; skipped: number; accountCount: number; fetchedCount: number }> {
    const appId = process.env.ENABLE_BANKING_APP_ID;
    const privateKeyPem = this.getEnableBankingPrivateKeyPem();
    if (!appId || !privateKeyPem) {
      throw new Error('Enable Banking credentials missing for sync');
    }

    const connections = await this.ensureEnableBankingConnections();
    const connection = connections.find((item) => item.bankKey === bankKey);
    const sessionId = connection && typeof connection.sessionId === 'string' ? connection.sessionId : null;
    if (!connection || !sessionId) {
      throw new Error('No hay sesión activa para este banco');
    }

    const bankName = String(connection.bankName);
    const jwt = this.createEnableBankingJwt(appId, privateKeyPem);
    const accountIdentities = await this.fetchEnableBankingAccountIdentities(sessionId, jwt);
    if (accountIdentities.length === 0) {
      throw new Error('No se encontraron cuentas para la sesión autorizada');
    }

    const transactions: CreateTransactionDto[] = [];

    for (let index = 0; index < accountIdentities.length; index += 1) {
      const identity = accountIdentities[index];
      // stableKey survives session renewal (Enable Banking rotates the per-session
      // uid on every reconnect but identification_hash stays the same for the
      // same real account), so it's used for account matching and dedup — the
      // live API call still needs the session-scoped uid.
      const localAccount = await this.getOrCreateBankAccount(bankKey, bankName, identity.stableKey, index);
      const payload = await this.fetchEnableBankingAccountTransactions(identity.uid, jwt);
      const rawEntries = this.extractEnableBankingTransactionEntries(payload);

      for (const rawEntry of rawEntries) {
        const mapped = this.mapEnableBankingEntryToTransaction(rawEntry, {
          fallbackAccountId: localAccount.id,
          sourceAccountId: identity.stableKey,
          bankKey,
        });

        if (mapped) {
          transactions.push(mapped);
        }
      }
    }

    if (transactions.length === 0) {
      // No new movements is a normal, successful outcome — not every sync finds fresh transactions.
      return { imported: 0, skipped: 0, accountCount: accountIdentities.length, fetchedCount: 0 };
    }

    const imported = await this.importTransactionsUnchecked({
      source: 'bank',
      transactions,
    });

    return {
      imported: imported.imported,
      skipped: imported.skipped ?? 0,
      accountCount: accountIdentities.length,
      fetchedCount: transactions.length,
    };
  }

  private async getOrCreateBankAccount(
    bankKey: string,
    bankName: string,
    externalAccountId: string,
    indexWithinBank: number,
  ): Promise<{ id: string }> {
    const existing = await this.accountModel.findOne({ bankKey, externalAccountId }).lean();
    if (existing) {
      return { id: String(existing.id) };
    }

    const account = await this.accountModel.create({
      id: `acc_${bankKey}_${externalAccountId.slice(0, 8)}`,
      // Enable Banking hashes IBAN/name for privacy, so accounts are labelled by
      // bank + a stable position instead of a real account name.
      name: `${bankName} · Cuenta ${indexWithinBank + 1}`,
      type: 'checking',
      balance: 0,
      currency: 'EUR',
      bankKey,
      bankName,
      externalAccountId,
      createdAt: new Date().toISOString(),
    });

    return { id: account.id };
  }

  private async fetchEnableBankingAccountIds(sessionId: string, jwt: string): Promise<string[]> {
    const identities = await this.fetchEnableBankingAccountIdentities(sessionId, jwt);
    return identities.map((identity) => identity.uid);
  }

  private async fetchEnableBankingAccountIdentities(
    sessionId: string,
    jwt: string,
  ): Promise<Array<{ uid: string; stableKey: string }>> {
    // /sessions/{id} is tried first: every other candidate has consistently 404'd
    // in practice, and this is the one response that also carries accounts_data
    // (needed to resolve the session-independent identification_hash below).
    const candidates = [
      `https://api.enablebanking.com/sessions/${sessionId}`,
      `https://api.enablebanking.com/sessions/${sessionId}/accounts`,
      `https://api.enablebanking.com/accounts?session_id=${encodeURIComponent(sessionId)}`,
      `https://api.enablebanking.com/accounts?session=${encodeURIComponent(sessionId)}`,
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
      const identities = this.extractEnableBankingAccountIdentities(parsed);
      if (identities.length > 0) {
        return identities;
      }
    }

    return [];
  }

  private extractEnableBankingAccountIdentities(
    payload: Record<string, unknown> | null,
  ): Array<{ uid: string; stableKey: string }> {
    const uids = this.extractEnableBankingAccountIds(payload);
    if (uids.length === 0) {
      return [];
    }

    // Enable Banking rotates each account's uid on every new session/consent, but
    // identification_hash (also privacy-preserving, no raw IBAN/name) stays the
    // same for the same real account across reconnects — confirmed by comparing
    // Bankinter's identification_hash values across two separate sessions.
    const hashByUid = new Map<string, string>();
    const accountsData = payload?.accounts_data;
    if (Array.isArray(accountsData)) {
      for (const entry of accountsData) {
        if (!entry || typeof entry !== 'object') {
          continue;
        }

        const record = entry as Record<string, unknown>;
        const uid = typeof record.uid === 'string' ? record.uid : null;
        const hash = typeof record.identification_hash === 'string' ? record.identification_hash : null;
        if (uid && hash) {
          hashByUid.set(uid, hash);
        }
      }
    }

    return uids.map((uid) => ({ uid, stableKey: hashByUid.get(uid) ?? uid }));
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
    const url = this.buildEnableBankingTransactionCandidates(accountId)[0];
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/json',
      },
    });

    const bodyText = await response.text();
    const parsed = this.safeParseJson(bodyText);

    if (response.status === 429) {
      const detail = parsed && typeof parsed.message === 'string' ? parsed.message : 'Rate limit exceeded';
      throw new Error(`Límite de accesos del banco alcanzado: ${detail}`);
    }

    if (!response.ok) {
      const detail = parsed ? JSON.stringify(parsed) : bodyText;
      throw new Error(`Enable Banking transactions request failed (${response.status}): ${detail}`);
    }

    return parsed;
  }

  private buildEnableBankingTransactionCandidates(accountId: string): string[] {
    const today = new Date();
    const dateFrom = new Date(today);
    dateFrom.setFullYear(today.getFullYear() - 1);
    const dateFromIso = dateFrom.toISOString().slice(0, 10);
    const dateToIso = today.toISOString().slice(0, 10);

    // Enable Banking's ASPSPs rate-limit accesses per consent (PSD2 access quota,
    // commonly a handful per day). Only the canonical endpoint is used so a single
    // sync/debug call spends at most one access per account instead of exhausting
    // the quota by probing many URL variants.
    return [
      `https://api.enablebanking.com/accounts/${accountId}/transactions?date_from=${dateFromIso}&date_to=${dateToIso}`,
    ];
  }

  private async probeEnableBankingTransactionEndpoints(
    accountId: string,
    jwt: string,
  ): Promise<Array<{ url: string; status: number; keys: string[]; entryCount: number; preview: string; sample: Record<string, unknown> | null }>> {
    const candidates = this.buildEnableBankingTransactionCandidates(accountId);
    const results: Array<{ url: string; status: number; keys: string[]; entryCount: number; preview: string; sample: Record<string, unknown> | null }> = [];

    for (const url of candidates) {
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
        const entries = parsed ? this.extractEnableBankingTransactionEntries(parsed) : [];

        results.push({
          url,
          status: response.status,
          keys: parsed ? Object.keys(parsed) : [],
          entryCount: entries.length,
          preview: bodyText.slice(0, 400),
          sample: entries[0] ?? null,
        });
      } catch (error) {
        results.push({
          url,
          status: 0,
          keys: [],
          entryCount: 0,
          preview: error instanceof Error ? error.message : 'request failed',
          sample: null,
        });
      }
    }

    return results;
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
    context: { fallbackAccountId: string; sourceAccountId: string; bankKey: string },
  ): CreateTransactionDto | null {
    const amountInfo = (entry.transactionAmount as Record<string, unknown> | undefined)
      ?? (entry.transaction_amount as Record<string, unknown> | undefined)
      ?? (entry.amount as Record<string, unknown> | undefined);
    const rawAmount = amountInfo?.amount ?? entry.amount;
    const numericAmount = Number(String(rawAmount).replace(',', '.'));
    if (!Number.isFinite(numericAmount) || numericAmount === 0) {
      return null;
    }

    // Enable Banking always reports the amount unsigned (e.g. "1.23", never "-1.23");
    // direction comes exclusively from credit_debit_indicator (CRDT/DBIT). Treating a
    // positive-but-unsigned amount as "income" by default misclassified every expense.
    const indicator = String(entry.creditDebitIndicator ?? entry.credit_debit_indicator ?? '').toUpperCase();
    const isIncome = indicator === 'CRDT';
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
      ? `${context.bankKey}:${context.sourceAccountId}:${externalIdCandidate}`
      : `${context.bankKey}:${context.sourceAccountId}:${date}:${amount}:${type}`;

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

    return this.importTransactionsUnchecked(dto);
  }

  // Used by the public /api/transactions/import HTTP endpoint (guarded above by
  // BANK_INGEST_API_KEY) and directly by the internal Enable Banking sync path,
  // which is already trusted server-side code and isn't an external HTTP caller.
  private async importTransactionsUnchecked(dto?: ImportTransactionsDto) {
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

  async getEnableBankingConnections() {
    const connections = await this.ensureEnableBankingConnections();
    return connections.map((connection) => ({
      bankKey: connection.bankKey,
      bankName: connection.bankName,
      status: connection.status,
      connected: connection.status === 'connected',
      sessionCreatedAt: connection.sessionCreatedAt ?? null,
      lastSyncAt: connection.lastSyncAt ?? null,
      lastSyncStatus: connection.lastSyncStatus ?? null,
      lastSyncImported: connection.lastSyncImported ?? null,
      lastSyncSkipped: connection.lastSyncSkipped ?? null,
      lastSyncError: connection.lastSyncError ?? null,
      accountCount: connection.accountCount ?? null,
      lastExchangeError: connection.lastExchangeError ?? null,
    }));
  }

  async getEnableBankingConnectUrl(bankKey: string) {
    const appId = process.env.ENABLE_BANKING_APP_ID;
    const redirectCandidates = this.getEnableBankingRedirectUrlCandidates();
    const privateKeyPem = this.getEnableBankingPrivateKeyPem();
    const country = process.env.ENABLE_BANKING_COUNTRY || 'ES';

    const connections = await this.ensureEnableBankingConnections();
    const target = connections.find((connection) => connection.bankKey === bankKey);
    if (!target) {
      return {
        configured: false,
        error: `Unknown bank key: ${bankKey}`,
        availableBanks: connections.map((connection) => connection.bankKey),
      };
    }

    if (!appId || redirectCandidates.length === 0 || !privateKeyPem) {
      return {
        configured: false,
        error: 'Missing ENABLE_BANKING_APP_ID, ENABLE_BANKING_PRIVATE_KEY_PEM/PATH or ENABLE_BANKING_REDIRECT_URL',
      };
    }

    const state = crypto.randomUUID();
    await this.updateEnableBankingConnection(bankKey, {
      status: 'pending',
      pendingState: state,
      pendingStateCreatedAt: new Date().toISOString(),
      lastExchangeError: null,
    });

    const jwt = this.createEnableBankingJwt(appId, privateKeyPem);
    // Enable Banking rejects any name that doesn't exactly match its ASPSP directory
    // (e.g. our "Unicaja" config vs. the directory's "Unicaja Banco"), so resolve it first.
    const targetBank = await this.resolveAspspName(String(target.bankName), country, jwt);
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
      await this.updateEnableBankingConnection(bankKey, {
        status: 'error',
        lastExchangeError: `Enable Banking connect URL request failed (${lastStatus || 'unknown'})`,
      });

      return {
        configured: false,
        error: `Enable Banking connect URL request failed (${lastStatus || 'unknown'})`,
        response: lastErrorDetail || 'No auth URL returned by provider',
      };
    }

    await this.updateEnableBankingConnection(bankKey, { pendingRedirectUrl: selectedRedirectUrl });

    return {
      configured: true,
      authUrl: resolvedAuthUrl,
      state,
      redirectUrl: selectedRedirectUrl,
      country,
      bank: targetBank,
      bankKey,
    };
  }

  async handleEnableBankingCallback(input: {
    code?: string;
    state?: string;
    error?: string;
    errorDescription?: string;
  }) {
    const receivedAt = new Date().toISOString();

    const connection = input.state ? await this.findConnectionByPendingState(input.state) : null;
    if (!connection) {
      return {
        ok: false,
        receivedAt,
        bankKey: null,
        bankName: null,
        sessionConnected: false,
        callbackError: input.error ?? 'No matching pending connection for this state',
        callbackErrorDescription: input.errorDescription ?? null,
        exchangeError: null,
      };
    }

    const bankKey = String(connection.bankKey);

    let sessionId: string | null = null;
    let exchangeError: string | null = null;

    if (input.code) {
      try {
        const exchanged = await this.exchangeEnableBankingCode(bankKey, input.code, input.state);
        sessionId = exchanged.sessionId;
      } catch (error) {
        exchangeError = error instanceof Error ? error.message : 'Unknown exchange error';
      }
    } else if (input.error) {
      exchangeError = input.errorDescription || input.error;
    }

    const patch: Record<string, unknown> = {
      pendingState: null,
      pendingStateCreatedAt: null,
      lastCallbackAt: receivedAt,
      lastExchangeError: exchangeError,
    };

    if (sessionId) {
      patch.status = 'connected';
      patch.sessionId = sessionId;
      patch.sessionCreatedAt = receivedAt;
    } else {
      patch.status = 'error';
    }

    const saved = await this.updateEnableBankingConnection(bankKey, patch);

    return {
      ok: Boolean(sessionId) && !input.error,
      receivedAt,
      bankKey,
      bankName: saved.bankName ?? null,
      sessionConnected: Boolean(sessionId),
      callbackError: input.error ?? null,
      callbackErrorDescription: input.errorDescription ?? null,
      exchangeError,
    };
  }

  async debugEnableBankingPull(bankKey?: string) {
    const connections = await this.ensureEnableBankingConnections();
    const connection = bankKey
      ? connections.find((item) => item.bankKey === bankKey)
      : connections.find((item) => item.status === 'connected');

    if (!connection) {
      return {
        ok: false,
        error: bankKey ? `Unknown or unconfigured bank: ${bankKey}` : 'No connected bank found',
        availableBanks: connections.map((item) => item.bankKey),
      };
    }

    const sessionId = typeof connection.sessionId === 'string' ? connection.sessionId : null;
    if (!sessionId) {
      return {
        ok: false,
        error: `Bank ${String(connection.bankKey)} is not connected yet`,
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
    const sessionProbe = probes.find((item) => item.url.endsWith(`/sessions/${sessionId}`));
    const sessionParsed = sessionProbe?.parsed ?? null;
    const accountIds = await this.fetchEnableBankingAccountIds(sessionId, jwt);
    const perAccount: Array<{
      accountId: string;
      transactionCount: number;
      sample: Record<string, unknown> | null;
      transactionProbes: Array<{ url: string; status: number; keys: string[]; entryCount: number; preview: string; sample: Record<string, unknown> | null }>;
    }> = [];
    let totalTransactions = 0;

    for (const accountId of accountIds) {
      // A single probe call doubles as the actual fetch (one candidate URL) so
      // debug-pull spends the same one access-per-account as a real sync.
      const transactionProbes = await this.probeEnableBankingTransactionEndpoints(accountId, jwt);
      const entryCount = transactionProbes.reduce((sum, probe) => sum + probe.entryCount, 0);
      const sample = transactionProbes.find((probe) => probe.sample)?.sample ?? null;
      totalTransactions += entryCount;
      perAccount.push({
        accountId,
        transactionCount: entryCount,
        sample,
        transactionProbes,
      });
    }

    return {
      ok: true,
      bankKey: connection.bankKey,
      sessionId,
      sessionAccess: sessionParsed?.access ?? null,
      sessionStatus: sessionParsed?.status ?? null,
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
    parsed: Record<string, unknown> | null;
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
      parsed: Record<string, unknown> | null;
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
          parsed,
        });
      } catch (error) {
        results.push({
          url,
          status: 0,
          hasJson: false,
          keys: [],
          preview: error instanceof Error ? error.message : 'request failed',
          parsed: null,
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
    await this.ensureSettingsInitialized();
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

  private async exchangeEnableBankingCode(bankKey: string, code: string, state?: string): Promise<{
    sessionId: string | null;
    raw: Record<string, unknown> | string;
  }> {
    const appId = process.env.ENABLE_BANKING_APP_ID;
    const connections = await this.ensureEnableBankingConnections();
    const connection = connections.find((item) => item.bankKey === bankKey);
    const stateRedirectUrl = connection?.pendingRedirectUrl;
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

  private getTargetBankConfigs(): Array<{ bankKey: string; bankName: string }> {
    const names = (process.env.ENABLE_BANKING_TARGET_BANKS || 'Bankinter,Unicaja,Caja Rural del Sur')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    return names.map((bankName) => ({ bankKey: this.normalizeBankName(bankName).replace(/ /g, '-'), bankName }));
  }

  private emptyEnableBankingConnection(
    bankKey: string,
    bankName: string,
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      bankKey,
      bankName,
      status: 'not_connected',
      sessionId: null,
      sessionCreatedAt: null,
      pendingState: null,
      pendingStateCreatedAt: null,
      pendingRedirectUrl: null,
      lastCallbackAt: null,
      lastExchangeError: null,
      lastSyncAt: null,
      lastSyncStatus: null,
      lastSyncImported: null,
      lastSyncSkipped: null,
      lastSyncError: null,
      accountCount: null,
      ...overrides,
    };
  }

  // Ensures every bank configured in ENABLE_BANKING_TARGET_BANKS has a connection
  // slot, migrating the pre-multi-bank single-session state (which always connected
  // the first configured bank) into that bank's slot the first time this runs.
  private async ensureEnableBankingConnections(): Promise<Array<Record<string, unknown>>> {
    const settings = await this.getOrCreateSettings();
    const integrationState = (settings.integrationState ?? {}) as Record<string, unknown>;
    const existing = Array.isArray(integrationState.enableBankingConnections)
      ? (integrationState.enableBankingConnections as Array<Record<string, unknown>>)
      : [];

    const targets = this.getTargetBankConfigs();
    const legacy = (integrationState.enableBanking ?? {}) as Record<string, unknown>;
    const legacySessionId = typeof legacy.latestSessionId === 'string' ? legacy.latestSessionId : null;

    const byKey = new Map(existing.map((connection) => [String(connection.bankKey), connection]));
    let changed = existing.length !== targets.length;

    const next = targets.map((target, index) => {
      const found = byKey.get(target.bankKey);
      if (found) {
        return found;
      }

      changed = true;
      if (index === 0 && legacySessionId) {
        return this.emptyEnableBankingConnection(target.bankKey, target.bankName, {
          status: 'connected',
          sessionId: legacySessionId,
          sessionCreatedAt: typeof legacy.latestSessionAt === 'string' ? legacy.latestSessionAt : new Date().toISOString(),
        });
      }

      return this.emptyEnableBankingConnection(target.bankKey, target.bankName);
    });

    if (changed) {
      await this.settingsModel.updateOne(
        { key: 'global' },
        { $set: { 'integrationState.enableBankingConnections': next } },
        { upsert: true },
      );
    }

    return next;
  }

  private async updateEnableBankingConnection(
    bankKey: string,
    patch: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const connections = await this.ensureEnableBankingConnections();
    const index = connections.findIndex((connection) => connection.bankKey === bankKey);
    if (index === -1) {
      throw new NotFoundException(`Unknown bank: ${bankKey}`);
    }

    connections[index] = { ...connections[index], ...patch };

    await this.settingsModel.updateOne(
      { key: 'global' },
      { $set: { 'integrationState.enableBankingConnections': connections } },
      { upsert: true },
    );

    return connections[index];
  }

  private async findConnectionByPendingState(state: string): Promise<Record<string, unknown> | null> {
    const connections = await this.ensureEnableBankingConnections();
    return connections.find((connection) => connection.pendingState === state) ?? null;
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

  // Enable Banking's /auth endpoint requires the exact ASPSP directory name
  // (e.g. "Unicaja Banco", not our shorter "Unicaja" config value).
  private async resolveAspspName(configuredName: string, country: string, jwt: string): Promise<string> {
    try {
      const response = await fetch(`https://api.enablebanking.com/aspsps?country=${country}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/json' },
      });

      if (!response.ok) {
        return configuredName;
      }

      const data = (await response.json()) as { aspsps?: Array<{ name?: string }> };
      const names = (data.aspsps ?? []).map((item) => item?.name).filter((name): name is string => Boolean(name));
      const matcher = this.buildTargetMatcher(configuredName);
      return names.find(matcher) ?? configuredName;
    } catch {
      return configuredName;
    }
  }

  private async ensureSettingsInitialized() {
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
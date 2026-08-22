import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
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
    const transaction = await this.transactionModel.create({
      id: `txn_${Date.now()}`,
      accountId: dto.accountId,
      categoryId: dto.categoryId,
      date: dto.date,
      amount,
      description: dto.description ?? '',
      type,
      source: dto.source ?? 'manual',
      createdAt: new Date().toISOString(),
    });

    if (type === 'income') {
      await this.accountModel.updateOne({ id: dto.accountId }, { $inc: { balance: amount } });
    } else {
      await this.accountModel.updateOne({ id: dto.accountId }, { $inc: { balance: -amount } });
    }

    return transaction.toObject();
  }

  async triggerBankSync(dto?: BankSyncDto) {
    const provider = dto?.provider ?? 'open-banking';
    const record = await this.syncHistoryModel.create({
      id: `sync_${Date.now()}`,
      provider,
      status: 'queued',
      syncAt: new Date().toISOString(),
    });
    const { _id, ...createdRecord } = record.toObject();

    return {
      id: createdRecord.id,
      provider,
      status: 'queued',
      syncAt: createdRecord.syncAt,
      message: 'Sincronización programada',
    };
  }

  async importTransactions(dto?: ImportTransactionsDto) {
    const source = dto?.source ?? 'n8n';
    const items = dto?.transactions ?? [];

    for (const transactionDto of items) {
      await this.createTransaction({
        ...transactionDto,
        type: transactionDto.type ?? 'expense',
        source: transactionDto.source ?? source,
      });
    }

    return {
      imported: items.length,
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
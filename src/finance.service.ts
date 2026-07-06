import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreateExpenseDto, UpdateFinanceSettingsDto } from './finance.dto';
import { Expense, ExpenseDocument } from './schemas/expense.schema';
import { FinanceSettings, FinanceSettingsDocument } from './schemas/finance-settings.schema';

@Injectable()
export class FinanceService {
  constructor(
    @InjectModel(FinanceSettings.name)
    private readonly settingsModel: Model<FinanceSettingsDocument>,
    @InjectModel(Expense.name)
    private readonly expenseModel: Model<ExpenseDocument>,
  ) {}

  async getBootstrap() {
    const settings = await this.getOrCreateSettings();
    const expenses = await this.expenseModel.find().sort({ date: -1, createdAt: -1 }).lean();

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
      categories: [],
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
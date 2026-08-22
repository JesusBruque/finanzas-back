import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { FinanceService } from './finance.service';
import {
  BankSyncDto,
  CreateAccountDto,
  CreateExpenseDto,
  CreateTransactionDto,
  ImportTransactionsDto,
  UpdateFinanceSettingsDto,
} from './finance.dto';

@Controller('finance')
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  @Get('bootstrap')
  getBootstrap() {
    return this.financeService.getBootstrap();
  }

  @Put('settings')
  updateSettings(@Body() dto: UpdateFinanceSettingsDto) {
    return this.financeService.updateSettings(dto);
  }

  @Post('expenses')
  createExpense(@Body() dto: CreateExpenseDto) {
    return this.financeService.createExpense(dto);
  }

  @Delete('expenses/:id')
  deleteExpense(@Param('id') id: string) {
    return this.financeService.deleteExpense(id);
  }
}

@Controller('api')
export class Block1Controller {
  constructor(private readonly financeService: FinanceService) {}

  @Get('accounts')
  getAccounts() {
    return this.financeService.getAccounts();
  }

  @Post('accounts')
  createAccount(@Body() dto: CreateAccountDto) {
    return this.financeService.createAccount(dto);
  }

  @Get('categories')
  getCategories() {
    return this.financeService.getCategories();
  }

  @Get('transactions')
  getTransactions() {
    return this.financeService.getTransactions();
  }

  @Post('transactions')
  createTransaction(@Body() dto: CreateTransactionDto) {
    return this.financeService.createTransaction(dto);
  }

  @Post('transactions/import')
  importTransactions(@Body() dto: ImportTransactionsDto) {
    return this.financeService.importTransactions(dto);
  }

  @Get('dashboard')
  getDashboard(
    @Query('month') month?: string,
    @Query('categoryId') categoryId?: string,
  ) {
    return this.financeService.getDashboard(month, categoryId);
  }

  @Get('budget-plan')
  getBudgetPlan() {
    return this.financeService.getBudgetPlan();
  }

  @Get('budget-alerts')
  getBudgetAlerts() {
    return this.financeService.getBudgetAlerts();
  }

  @Post('bank-sync')
  triggerBankSync(@Body() dto: BankSyncDto) {
    return this.financeService.triggerBankSync(dto);
  }

  @Get('sync-history')
  getSyncHistory() {
    return this.financeService.getSyncHistory();
  }
}
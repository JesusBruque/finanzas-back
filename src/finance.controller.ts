import { Body, Controller, Delete, Get, Headers, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { FinanceService } from './finance.service';
import {
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
  importTransactions(
    @Body() dto: ImportTransactionsDto,
    @Headers('x-api-key') apiKey?: string,
  ) {
    return this.financeService.importTransactions(dto, apiKey);
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
  triggerBankSync() {
    return this.financeService.triggerBankSync();
  }

  @Post('bank-sync/scheduled')
  triggerScheduledBankSync(@Headers('x-api-key') apiKey?: string) {
    return this.financeService.triggerScheduledBankSync(apiKey);
  }

  @Get('sync-history')
  getSyncHistory() {
    return this.financeService.getSyncHistory();
  }

  @Get('enablebanking/target-banks')
  getEnableBankingTargetBanks() {
    return this.financeService.getEnableBankingTargetBanks();
  }

  @Get('enablebanking/connections')
  getEnableBankingConnections() {
    return this.financeService.getEnableBankingConnections();
  }

  @Get('enablebanking/connect-url')
  getEnableBankingConnectUrl(@Query('bank') bank?: string) {
    if (!bank) {
      return { configured: false, error: 'Missing required "bank" query parameter' };
    }

    return this.financeService.getEnableBankingConnectUrl(bank);
  }

  @Get('enablebanking/callback')
  async handleEnableBankingCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Query('error_description') errorDescription: string | undefined,
    @Res() res: Response,
  ) {
    const result = await this.financeService.handleEnableBankingCallback({
      code,
      state,
      error,
      errorDescription,
    });

    const frontendUrl = process.env.FRONTEND_APP_URL?.trim();
    if (frontendUrl) {
      const redirectUrl = new URL(frontendUrl);
      redirectUrl.searchParams.set('bank_connected', result.ok ? 'success' : 'error');
      if (result.bankKey) {
        redirectUrl.searchParams.set('bank', result.bankKey);
      }
      res.redirect(302, redirectUrl.toString());
      return;
    }

    res.status(200).json(result);
  }

  @Get('enable-banking/callback')
  handleEnableBankingCallbackAlias(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Query('error_description') errorDescription: string | undefined,
    @Res() res: Response,
  ) {
    return this.handleEnableBankingCallback(code, state, error, errorDescription, res);
  }

  @Get('enablebanking/debug-pull')
  debugEnableBankingPull(@Query('bank') bank?: string) {
    return this.financeService.debugEnableBankingPull(bank);
  }
}

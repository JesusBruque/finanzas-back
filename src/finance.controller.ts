import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { FinanceService } from './finance.service';
import { CreateExpenseDto, UpdateFinanceSettingsDto } from './finance.dto';

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
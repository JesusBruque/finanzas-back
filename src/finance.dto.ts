import { Type } from 'class-transformer';
import { IsArray, IsIn, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';

export class CategoryDto {
  name: string;
  percentage: number;
}

export class UpdateFinanceSettingsDto {
  salaryJesus: number;
  salaryAlba: number;
  monthStartDay: number;
  categories: CategoryDto[];
}

export class CreateExpenseDto {
  date: string;
  category: string;
  amount: number;
  description: string;
}

export class CreateAccountDto {
  name: string;
  type: 'checking' | 'savings' | 'credit';
  balance: number;
  currency: string;
}

export class CreateTransactionDto {
  accountId: string;
  categoryId: string;
  date: string;
  amount: number;
  description: string;
  type: 'income' | 'expense';

  @IsOptional()
  @IsIn(['manual', 'bank', 'n8n'])
  source?: 'manual' | 'bank' | 'n8n';
}

export class BankSyncDto {
  @IsOptional()
  @IsString()
  provider?: string;
}

export class ImportTransactionsDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateTransactionDto)
  transactions?: CreateTransactionDto[];

  @IsOptional()
  @IsIn(['manual', 'bank', 'n8n'])
  source?: 'manual' | 'bank' | 'n8n';
}
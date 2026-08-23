import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  ValidateNested,
} from 'class-validator';

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
  @IsString()
  accountId: string;

  @IsString()
  categoryId: string;

  @IsDateString()
  date: string;

  @IsNumber()
  @IsPositive()
  amount: number;

  @IsString()
  description: string;

  @IsIn(['income', 'expense'])
  type: 'income' | 'expense';

  @IsOptional()
  @IsString()
  externalId?: string;

  @IsOptional()
  @IsIn(['manual', 'bank', 'n8n'])
  source?: 'manual' | 'bank' | 'n8n';
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
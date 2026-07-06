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
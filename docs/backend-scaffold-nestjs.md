# Backend scaffold - NestJS para Finanzas

## Estructura recomendada

```text
finance-api/
├─ src/
│  ├─ app.module.ts
│  ├─ main.ts
│  ├─ app.controller.ts
│  ├─ app.service.ts
│  ├─ accounts/
│  │  ├─ accounts.controller.ts
│  │  ├─ accounts.service.ts
│  │  ├─ accounts.module.ts
│  │  ├─ dto/
│  │  │  ├─ create-account.dto.ts
│  │  │  └─ update-account.dto.ts
│  │  └─ entities/
│  │     └─ account.entity.ts
│  ├─ categories/
│  │  ├─ categories.controller.ts
│  │  ├─ categories.service.ts
│  │  ├─ categories.module.ts
│  │  ├─ dto/
│  │  │  └─ create-category.dto.ts
│  │  └─ entities/
│  │     └─ category.entity.ts
│  ├─ transactions/
│  │  ├─ transactions.controller.ts
│  │  ├─ transactions.service.ts
│  │  ├─ transactions.module.ts
│  │  ├─ dto/
│  │  │  └─ create-transaction.dto.ts
│  │  └─ entities/
│  │     └─ transaction.entity.ts
│  └─ dashboard/
│     ├─ dashboard.controller.ts
│     ├─ dashboard.service.ts
│     └─ dashboard.module.ts
├─ prisma/
│  └─ schema.prisma
├─ .env
├─ package.json
├─ tsconfig.json
├─ nest-cli.json
└─ README.md
```

## package.json

```json
{
  "name": "finance-api",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "build": "nest build",
    "start": "nest start",
    "start:dev": "nest start --watch",
    "start:prod": "node dist/main",
    "test": "jest"
  },
  "dependencies": {
    "@nestjs/common": "^10.0.0",
    "@nestjs/core": "^10.0.0",
    "@nestjs/platform-express": "^10.0.0",
    "class-transformer": "^0.5.0",
    "class-validator": "^0.13.0",
    "@prisma/client": "^5.0.0",
    "prisma": "^5.0.0",
    "uuid": "^9.0.0"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.0.0",
    "@nestjs/schematics": "^10.0.0",
    "@types/express": "^4.0.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0",
    "ts-node": "^10.0.0",
    "jest": "^29.0.0",
    "ts-jest": "^29.0.0"
  }
}
```

## main.ts

```ts
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen(3000);
}

bootstrap();
```

## app.module.ts

```ts
import { Module } from '@nestjs/common';
import { AccountsModule } from './accounts/accounts.module';
import { CategoriesModule } from './categories/categories.module';
import { TransactionsModule } from './transactions/transactions.module';
import { DashboardModule } from './dashboard/dashboard.module';

@Module({
  imports: [AccountsModule, CategoriesModule, TransactionsModule, DashboardModule],
})
export class AppModule {}
```

## DTOs

### create-account.dto.ts

```ts
import { IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateAccountDto {
  @IsString()
  name: string;

  @IsString()
  @IsEnum(['checking', 'savings', 'credit'])
  type: 'checking' | 'savings' | 'credit';

  @IsNumber()
  balance: number;

  @IsString()
  currency: string;

  @IsOptional()
  @IsString()
  createdAt?: string;
}
```

### create-category.dto.ts

```ts
import { IsEnum, IsString } from 'class-validator';

export class CreateCategoryDto {
  @IsString()
  name: string;

  @IsString()
  @IsEnum(['income', 'expense'])
  type: 'income' | 'expense';

  @IsString()
  color: string;
}
```

### create-transaction.dto.ts

```ts
import { IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateTransactionDto {
  @IsString()
  accountId: string;

  @IsString()
  categoryId: string;

  @IsString()
  date: string;

  @IsNumber()
  amount: number;

  @IsString()
  description: string;

  @IsString()
  @IsEnum(['income', 'expense'])
  type: 'income' | 'expense';

  @IsOptional()
  @IsString()
  @IsEnum(['manual', 'bank', 'n8n'])
  source?: 'manual' | 'bank' | 'n8n';
}
```

## Account entity

```ts
export class Account {
  id: string;
  name: string;
  type: 'checking' | 'savings' | 'credit';
  balance: number;
  currency: string;
  createdAt: string;
}
```

## Category entity

```ts
export class Category {
  id: string;
  name: string;
  type: 'income' | 'expense';
  color: string;
}
```

## Transaction entity

```ts
export class Transaction {
  id: string;
  accountId: string;
  categoryId: string;
  date: string;
  amount: number;
  description: string;
  type: 'income' | 'expense';
  source: 'manual' | 'bank' | 'n8n';
  createdAt: string;
}
```

## Accounts service

```ts
import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { Account } from './entities/account.entity';
import { CreateAccountDto } from './dto/create-account.dto';

@Injectable()
export class AccountsService {
  private accounts: Account[] = [
    {
      id: 'acc_001',
      name: 'Cuenta principal',
      type: 'checking',
      balance: 2450.75,
      currency: 'EUR',
      createdAt: new Date().toISOString(),
    },
  ];

  findAll(): Account[] {
    return this.accounts;
  }

  create(dto: CreateAccountDto): Account {
    const account: Account = {
      id: `acc_${uuidv4()}`,
      name: dto.name,
      type: dto.type,
      balance: dto.balance,
      currency: dto.currency,
      createdAt: new Date().toISOString(),
    };

    this.accounts.push(account);
    return account;
  }
}
```

## Accounts controller

```ts
import { Body, Controller, Get, Post } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { CreateAccountDto } from './dto/create-account.dto';

@Controller('accounts')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Get()
  findAll() {
    return this.accountsService.findAll();
  }

  @Post()
  create(@Body() dto: CreateAccountDto) {
    return this.accountsService.create(dto);
  }
}
```

## Categories service

```ts
import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { Category } from './entities/category.entity';
import { CreateCategoryDto } from './dto/create-category.dto';

@Injectable()
export class CategoriesService {
  private categories: Category[] = [
    { id: 'cat_001', name: 'Supermercado', type: 'expense', color: '#39b5e0' },
    { id: 'cat_002', name: 'Nomina', type: 'income', color: '#22c55e' },
    { id: 'cat_003', name: 'Transporte', type: 'expense', color: '#f59e0b' },
    { id: 'cat_004', name: 'Ocio', type: 'expense', color: '#a855f7' },
  ];

  findAll(): Category[] {
    return this.categories;
  }

  create(dto: CreateCategoryDto): Category {
    const category: Category = {
      id: `cat_${uuidv4()}`,
      name: dto.name,
      type: dto.type,
      color: dto.color,
    };

    this.categories.push(category);
    return category;
  }
}
```

## Categories controller

```ts
import { Body, Controller, Get, Post } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  findAll() {
    return this.categoriesService.findAll();
  }

  @Post()
  create(@Body() dto: CreateCategoryDto) {
    return this.categoriesService.create(dto);
  }
}
```

## Transactions service

```ts
import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { Transaction } from './entities/transaction.entity';
import { CreateTransactionDto } from './dto/create-transaction.dto';

@Injectable()
export class TransactionsService {
  private transactions: Transaction[] = [
    {
      id: 'txn_001',
      accountId: 'acc_001',
      categoryId: 'cat_001',
      date: '2026-08-20',
      amount: 84.5,
      description: 'Compra supermercado',
      type: 'expense',
      source: 'manual',
      createdAt: new Date().toISOString(),
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
      createdAt: new Date().toISOString(),
    },
  ];

  findAll(): Transaction[] {
    return this.transactions;
  }

  create(dto: CreateTransactionDto): Transaction {
    const transaction: Transaction = {
      id: `txn_${uuidv4()}`,
      accountId: dto.accountId,
      categoryId: dto.categoryId,
      date: dto.date,
      amount: dto.amount,
      description: dto.description,
      type: dto.type,
      source: dto.source ?? 'manual',
      createdAt: new Date().toISOString(),
    };

    this.transactions.push(transaction);
    return transaction;
  }
}
```

## Transactions controller

```ts
import { Body, Controller, Get, Post } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';

@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Get()
  findAll() {
    return this.transactionsService.findAll();
  }

  @Post()
  create(@Body() dto: CreateTransactionDto) {
    return this.transactionsService.create(dto);
  }
}
```

## Dashboard service

```ts
import { Injectable } from '@nestjs/common';

@Injectable()
export class DashboardService {
  getSummary() {
    return {
      totalIncome: 2200,
      totalExpense: 184.5,
      balance: 2015.5,
      monthlyTransactions: 4,
    };
  }
}
```

## Dashboard controller

```ts
import { Controller, Get } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  getSummary() {
    return this.dashboardService.getSummary();
  }
}
```

## Módulos

### accounts.module.ts

```ts
import { Module } from '@nestjs/common';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';

@Module({
  controllers: [AccountsController],
  providers: [AccountsService],
  exports: [AccountsService],
})
export class AccountsModule {}
```

### categories.module.ts

```ts
import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';

@Module({
  controllers: [CategoriesController],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
```

### transactions.module.ts

```ts
import { Module } from '@nestjs/common';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

@Module({
  controllers: [TransactionsController],
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
```

### dashboard.module.ts

```ts
import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
```

## Próximo paso recomendado

- Crear el proyecto NestJS en el otro VS Code
- Implementar los módulos anteriores
- Validar con Postman o curl
- Conectar el frontend con el backend usando el servicio ya definido en Angular

## Reglas de integración con Angular

- La API debe estar en `/api`
- La respuesta debe ser JSON plano
- Los nombres deben coincidir con los definidos en el contrato del frontend
- Si se cambia un campo en backend, se comunica antes de tocar el frontend

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { Block1Controller, FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { Account, AccountSchema } from './schemas/account.schema';
import { Expense, ExpenseSchema } from './schemas/expense.schema';
import { FinanceSettings, FinanceSettingsSchema } from './schemas/finance-settings.schema';
import { SyncHistory, SyncHistorySchema } from './schemas/sync-history.schema';
import { Transaction, TransactionSchema } from './schemas/transaction.schema';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      useFactory: async () => {
        const uri = process.env.MONGODB_URI;
        if (uri) {
          return { uri };
        }

        const mongoMemoryServer = await MongoMemoryServer.create();
        const memoryUri = mongoMemoryServer.getUri();
        process.env.MONGODB_URI = memoryUri;
        return { uri: memoryUri };
      },
    }),
    MongooseModule.forFeature([
      { name: Account.name, schema: AccountSchema },
      { name: Expense.name, schema: ExpenseSchema },
      { name: FinanceSettings.name, schema: FinanceSettingsSchema },
      { name: SyncHistory.name, schema: SyncHistorySchema },
      { name: Transaction.name, schema: TransactionSchema },
    ]),
  ],
  controllers: [AppController, FinanceController, Block1Controller],
  providers: [AppService, FinanceService],
})
export class AppModule {}

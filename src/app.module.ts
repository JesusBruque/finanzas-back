import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { Expense, ExpenseSchema } from './schemas/expense.schema';
import { FinanceSettings, FinanceSettingsSchema } from './schemas/finance-settings.schema';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('MONGODB_URI') ?? 'mongodb://127.0.0.1:27017/finanzas',
      }),
    }),
    MongooseModule.forFeature([
      { name: FinanceSettings.name, schema: FinanceSettingsSchema },
      { name: Expense.name, schema: ExpenseSchema },
    ]),
  ],
  controllers: [AppController, FinanceController],
  providers: [AppService, FinanceService],
})
export class AppModule {}

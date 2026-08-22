import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type TransactionDocument = HydratedDocument<Transaction>;

@Schema({ versionKey: false })
export class Transaction {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ required: true })
  accountId: string;

  @Prop({ required: true })
  categoryId: string;

  @Prop({ required: true })
  date: string;

  @Prop({ required: true, min: 0 })
  amount: number;

  @Prop({ required: true, trim: true, default: '' })
  description: string;

  @Prop({ required: true, enum: ['income', 'expense'] })
  type: 'income' | 'expense';

  @Prop({ required: true, enum: ['manual', 'bank', 'n8n'] })
  source: 'manual' | 'bank' | 'n8n';

  @Prop({ required: true, default: () => new Date().toISOString() })
  createdAt: string;
}

export const TransactionSchema = SchemaFactory.createForClass(Transaction);

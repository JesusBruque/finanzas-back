import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ExpenseDocument = HydratedDocument<Expense>;

@Schema({ timestamps: true, versionKey: false })
export class Expense {
  @Prop({ required: true })
  date: string;

  @Prop({ required: true, trim: true })
  category: string;

  @Prop({ required: true, min: 0 })
  amount: number;

  @Prop({ default: '', trim: true })
  description: string;
}

export const ExpenseSchema = SchemaFactory.createForClass(Expense);
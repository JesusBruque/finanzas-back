import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AccountDocument = HydratedDocument<Account>;

@Schema({ versionKey: false })
export class Account {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, enum: ['checking', 'savings', 'credit'] })
  type: 'checking' | 'savings' | 'credit';

  @Prop({ required: true, default: 0 })
  balance: number;

  @Prop({ required: true, default: 'EUR' })
  currency: string;

  @Prop({ required: true, default: () => new Date().toISOString() })
  createdAt: string;

  @Prop()
  bankKey?: string;

  @Prop()
  bankName?: string;

  @Prop()
  externalAccountId?: string;
}

export const AccountSchema = SchemaFactory.createForClass(Account);

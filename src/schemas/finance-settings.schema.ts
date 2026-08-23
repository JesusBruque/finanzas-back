import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type FinanceSettingsDocument = HydratedDocument<FinanceSettings>;

@Schema({ _id: false, versionKey: false })
export class FinanceCategory {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, min: 0 })
  percentage: number;
}

const FinanceCategorySchema = SchemaFactory.createForClass(FinanceCategory);

@Schema({ timestamps: true, versionKey: false })
export class FinanceSettings {
  @Prop({ required: true, unique: true, default: 'global' })
  key: string;

  @Prop({ default: 0, min: 0 })
  salaryJesus: number;

  @Prop({ default: 0, min: 0 })
  salaryAlba: number;

  @Prop({ default: 1, min: 1, max: 31 })
  monthStartDay: number;

  @Prop({ type: [FinanceCategorySchema], default: [] })
  categories: FinanceCategory[];

  @Prop({ type: Object, default: {} })
  integrationState: Record<string, unknown>;
}

export const FinanceSettingsSchema = SchemaFactory.createForClass(FinanceSettings);
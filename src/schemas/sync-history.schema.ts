import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type SyncHistoryDocument = HydratedDocument<SyncHistory>;

@Schema({ versionKey: false })
export class SyncHistory {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ required: true, trim: true })
  provider: string;

  @Prop({ required: true, trim: true })
  status: string;

  @Prop({ required: true, default: () => new Date().toISOString() })
  syncAt: string;
}

export const SyncHistorySchema = SchemaFactory.createForClass(SyncHistory);

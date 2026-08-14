import { Schema } from 'mongoose';
import { Cradle } from 'hongs-crud';

const userSchema = new Schema(
  {
    name:      { type: String, required: true },
    email:     { type: String, required: true },
    age:       { type: Number, min: 0, max: 150 },
    role:      { type: String, enum: ['admin', 'agent', 'user'], default: 'user' },
    isDeleted: { type: Boolean, default: false },
  },
  {
    collection: 'users',
    softDelete: { field: 'isDeleted' },
    timestamps: true,
  },
);

export const userCrud = new Cradle(userSchema);

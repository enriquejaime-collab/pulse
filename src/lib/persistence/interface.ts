import type { ImportBatch, Transaction } from "@/src/lib/persistence/types";

export interface LocalPersistence {
  listBatches(): Promise<ImportBatch[]>;
  listTransactions(): Promise<Transaction[]>;
  saveImportBatch(batch: ImportBatch, transactions: Transaction[]): Promise<void>;
  deleteImportBatch(batchId: string): Promise<void>;
  clearAll(): Promise<void>;
}

export class PersistenceNotConfiguredError extends Error {
  constructor() {
    super("Local persistence adapter has not been configured yet.");
    this.name = "PersistenceNotConfiguredError";
  }
}

export function createLocalPersistence(): LocalPersistence {
  const notImplemented = async (): Promise<never> => {
    throw new PersistenceNotConfiguredError();
  };

  return {
    listBatches: notImplemented,
    listTransactions: notImplemented,
    saveImportBatch: notImplemented,
    deleteImportBatch: notImplemented,
    clearAll: notImplemented
  };
}

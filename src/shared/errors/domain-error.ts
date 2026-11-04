export interface DomainErrorOptions {
  transient?: boolean;
}

export abstract class DomainError extends Error {
  readonly transient: boolean;

  constructor(message: string, { transient = false }: DomainErrorOptions = {}) {
    super(message);
    this.name = new.target.name;
    this.transient = transient;
  }
}

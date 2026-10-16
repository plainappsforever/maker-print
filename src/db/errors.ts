/** Thrown by data functions when a value would break the schema or a JSON guard (caller bug or bad input). */
export class InvalidDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDataError';
  }
}

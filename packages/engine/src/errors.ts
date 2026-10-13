/** Thrown by scaffold stubs. The message names the TASKS.md id that implements it. */
export class NotImplementedError extends Error {
  constructor(taskId: string, what: string) {
    super(`${what} is not implemented yet (${taskId}, see docs/archive/TASKS.md)`);
    this.name = 'NotImplementedError';
  }
}

declare module 'node:sqlite' {
  export class StatementSync {
    run(...params: any[]): any;
    get(...params: any[]): any;
    all(...params: any[]): any[];
  }

  export class DatabaseSync {
    constructor(path: string, options?: { readOnly?: boolean });
    prepare(sql: string): StatementSync;
    exec(sql: string): void;
    close(): void;
  }
}
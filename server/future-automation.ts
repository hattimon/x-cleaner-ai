export type FeatureArea = 'publisher' | 'engagement' | 'intelligence' | 'agent';
export type Access = 'read' | 'prepare' | 'confirm';

export interface AutomationContext {
  userId: string;
  accountId: string;
  scopes: ReadonlySet<string>;
}

export interface AutomationTool<Input, Output> {
  area: FeatureArea;
  name: string;
  access: Exclude<Access, 'confirm'>;
  run(context: AutomationContext, input: Input): Promise<Output>;
}

export interface PendingApproval<Purpose extends string, Payload> {
  ownerId: string;
  accountId: string;
  purpose: Purpose;
  revision: number;
  payload: Payload;
  expiresAt: Date;
}

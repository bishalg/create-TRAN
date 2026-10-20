export type { VoteEligibilityInput, VoteEligibilityOutput } from '@tran/api';

/** Components the API can observe in-process (REQ-API-012). */
export type StackLayer = 'rustcore' | 'axumapi';

export interface StackComponentStatus {
  layer: StackLayer;
  name: string;
  version: string;
  healthy: boolean;
  uptime_seconds: number;
}

export interface TranHealthReport {
  report_id: string;
  timestamp: string;
  overall_status: string;
  components: StackComponentStatus[];
}

export interface TranStackInfo {
  stack: string;
  description: string;
  demo?: string;
  layers: {
    T: string;
    R: string;
    A: string;
    N: string;
  };
  version: string;
}

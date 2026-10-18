export type { VoteEligibilityInput, VoteEligibilityOutput } from '@tran/api';

export type StackLayer = 'tanstackstart' | 'rustcore' | 'axumapi' | 'nativemobile';

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

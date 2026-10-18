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

export type MathOperation = 'add' | 'subtract' | 'multiply' | 'divide' | 'power';

export interface CalculationRequest {
  a: number;
  b: number;
  operation: MathOperation | string;
}

export interface CalculationResponse {
  calculation_id: string;
  result: number;
  computed_at: string;
  execution_micros: number;
}

export interface TranStackInfo {
  stack: string;
  description: string;
  layers: {
    T: string;
    R: string;
    A: string;
    N: string;
  };
  version: string;
}

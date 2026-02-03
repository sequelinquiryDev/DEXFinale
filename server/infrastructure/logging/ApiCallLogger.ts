/**
 * ApiCallLogger - Audit Trail for Data Source Tracking
 * 
 * RESPONSIBILITY: Log all API calls with complete context
 * - Which API was called (Etherscan, PolygonScan, RPC, Alchemy, etc)
 * - Request parameters (what data was requested)
 * - Response (what data was returned)
 * - Timing (latency)
 * - Errors (failures)
 * - Used by Market Viewer and Swapper for data source attribution
 * 
 * Each log entry includes:
 * - API name (where data came from)
 * - Endpoint (specific resource)
 * - Chain ID (network)
 * - Status (success/error)
 * - Duration (milliseconds)
 * - Used for market data "dataSource" field
 */

export interface ApiCallLogEntry {
  // Identifiers
  id: string;
  timestamp: number;
  traceId: string; // For correlating related calls
  
  // API Information
  apiName: string; // 'Etherscan', 'PolygonScan', 'Infura', 'Alchemy', 'RPC-Fallback'
  endpoint: string; // '/api?action=tokensearch', '/eth_call', etc
  chainId: number;
  
  // Request Details
  requestMethod: 'GET' | 'POST' | 'RPC_CALL';
  requestData?: any; // Query params or RPC params
  tokenCount?: number; // Number of tokens in the request
  
  // Response Details
  statusCode?: number; // HTTP status
  responseData?: any; // First 500 chars of response
  error?: string; // Error message if failed
  errorCode?: string; // Error category
  
  // Performance
  durationMs: number; // Request duration
  
  // Context
  requestedBy?: string; // Service name (MarketViewerService, SwapController, etc)
  purpose?: string; // What was this call for
  cached: boolean; // Was this cached
  fallback: boolean; // Was this a fallback attempt
}

export interface ApiCallStats {
  totalCalls: number;
  successCalls: number;
  failedCalls: number;
  cachedCalls: number;
  fallbackCalls: number;
  averageDurationMs: number;
  apiBreakdown: { [apiName: string]: number };
}

/**
 * Service to log and track all API calls
 * Provides audit trail for data source attribution
 */
export class ApiCallLogger {
  private logs: ApiCallLogEntry[] = [];
  private readonly MAX_LOGS = 10000; // Keep rolling buffer
  private startTime = Date.now();

  /**
   * Log an API call
   */
  public log(entry: Omit<ApiCallLogEntry, 'id' | 'timestamp'>): ApiCallLogEntry {
    const logEntry: ApiCallLogEntry = {
      ...entry,
      id: this.generateId(),
      timestamp: Date.now(),
    };

    // Keep logs bounded
    if (this.logs.length >= this.MAX_LOGS) {
      this.logs.shift();
    }

    this.logs.push(logEntry);
    this.printLog(logEntry);

    return logEntry;
  }

  /**
   * Log a successful API call
   */
  public logSuccess(
    apiName: string,
    endpoint: string,
    chainId: number,
    durationMs: number,
    options?: { requestedBy?: string; purpose?: string; cached?: boolean; tokenCount?: number }
  ): ApiCallLogEntry {
    return this.log({
      apiName,
      endpoint,
      chainId,
      requestMethod: 'RPC_CALL',
      statusCode: 200,
      durationMs,
      cached: options?.cached || false,
      fallback: false,
      requestedBy: options?.requestedBy,
      purpose: options?.purpose,
      tokenCount: options?.tokenCount,
      traceId: this.generateTraceId(),
    });
  }

  /**
   * Log a failed API call
   */
  public logError(
    apiName: string,
    endpoint: string,
    chainId: number,
    error: any,
    durationMs: number,
    options?: { requestedBy?: string; purpose?: string; fallback?: boolean }
  ): ApiCallLogEntry {
    const errorMessage = error instanceof Error ? error.message : String(error);

    return this.log({
      apiName,
      endpoint,
      chainId,
      requestMethod: 'RPC_CALL',
      statusCode: 500,
      error: errorMessage,
      errorCode: error?.code || 'UNKNOWN',
      durationMs,
      cached: false,
      fallback: options?.fallback || false,
      requestedBy: options?.requestedBy,
      purpose: options?.purpose,
      traceId: this.generateTraceId(),
    });
  }

  /**
   * Get logs for a specific API
   */
  public getLogsForApi(apiName: string): ApiCallLogEntry[] {
    return this.logs.filter(log => log.apiName === apiName);
  }

  /**
   * Get logs for a specific chain
   */
  public getLogsForChain(chainId: number): ApiCallLogEntry[] {
    return this.logs.filter(log => log.chainId === chainId);
  }

  /**
   * Get recent logs
   */
  public getRecentLogs(count: number = 50): ApiCallLogEntry[] {
    return this.logs.slice(-count);
  }

  /**
   * Get statistics about API calls
   */
  public getStats(): ApiCallStats {
    const totalCalls = this.logs.length;
    const successCalls = this.logs.filter(log => log.statusCode === 200).length;
    const failedCalls = this.logs.filter(log => log.statusCode !== 200).length;
    const cachedCalls = this.logs.filter(log => log.cached).length;
    const fallbackCalls = this.logs.filter(log => log.fallback).length;

    const averageDurationMs =
      totalCalls > 0 ? this.logs.reduce((sum, log) => sum + log.durationMs, 0) / totalCalls : 0;

    // API breakdown
    const apiBreakdown: { [key: string]: number } = {};
    for (const log of this.logs) {
      apiBreakdown[log.apiName] = (apiBreakdown[log.apiName] || 0) + 1;
    }

    return {
      totalCalls,
      successCalls,
      failedCalls,
      cachedCalls,
      fallbackCalls,
      averageDurationMs: Math.round(averageDurationMs),
      apiBreakdown,
    };
  }

  /**
   * Clear all logs
   */
  public clear(): void {
    this.logs = [];
  }

  /**
   * Export logs as JSON
   */
  public exportAsJson(): string {
    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        uptime: Date.now() - this.startTime,
        stats: this.getStats(),
        logs: this.logs,
      },
      null,
      2
    );
  }

  /**
   * Get data source attribution for a piece of data
   * Used to populate TokenMarketData.dataSource field
   */
  public getDataSourceAttribution(
    apiName: string,
    chainId: number,
    purpose?: string
  ): string {
    // Check if we have successful calls for this API
    const recentCall = this.logs
      .filter(log => log.apiName === apiName && log.chainId === chainId)
      .sort((a, b) => b.timestamp - a.timestamp)[0];

    if (!recentCall) {
      return 'unknown';
    }

    if (recentCall.cached) {
      return 'cached';
    }

    if (apiName.includes('RPC')) {
      return 'rpc-call';
    }

    if (apiName.includes('Explorer') || apiName === 'Etherscan' || apiName === 'PolygonScan') {
      return 'explorer-api';
    }

    if (apiName === 'Alchemy') {
      return 'alchemy-api';
    }

    if (purpose === 'multicall') {
      return 'multicall';
    }

    return 'unknown';
  }

  /**
   * INTERNAL: Generate unique ID
   */
  private generateId(): string {
    return `log-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * INTERNAL: Generate trace ID for correlation
   */
  private generateTraceId(): string {
    return `trace-${Math.random().toString(36).substr(2, 12)}`;
  }

  /**
   * INTERNAL: Print log to console for debugging
   */
  private printLog(entry: ApiCallLogEntry): void {
    const status = entry.statusCode === 200 ? '✓' : '✗';
    const source = entry.cached ? '(cached)' : entry.fallback ? '(fallback)' : '';
    const duration = `${entry.durationMs}ms`;
    const tokenCount = entry.tokenCount ? `(${entry.tokenCount} tokens)` : '';

    console.log(
      `[API] ${status} ${entry.apiName} | ${entry.endpoint.substring(0, 50)} | Chain ${entry.chainId} | ${duration} ${source} ${tokenCount}`
    );

    if (entry.error) {
      console.log(`      Error: ${entry.error}`);
    }
  }
}

// Export singleton
let instance: ApiCallLogger;

export function getApiCallLogger(): ApiCallLogger {
  if (!instance) {
    instance = new ApiCallLogger();
  }
  return instance;
}

export { ApiCallLogger as default };

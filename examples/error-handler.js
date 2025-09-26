/**
 * Comprehensive Error Handling Utilities
 * Provides graceful degradation patterns and error recovery mechanisms
 */

class ErrorHandler {
    constructor(options = {}) {
        this.maxRetries = options.maxRetries || 3;
        this.retryDelay = options.retryDelay || 1000;
        this.enableLogging = options.enableLogging !== false;
        this.fallbackEnabled = options.fallbackEnabled !== false;
    }

    /**
     * Retry function with exponential backoff
     */
    async retry(fn, context = 'operation', maxRetries = this.maxRetries) {
        let lastError;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                if (this.enableLogging && attempt > 1) {
                    console.log(`Retrying ${context} (attempt ${attempt}/${maxRetries})`);
                }

                const result = await fn();

                if (this.enableLogging && attempt > 1) {
                    console.log(`${context} succeeded on attempt ${attempt}`);
                }

                return result;

            } catch (error) {
                lastError = error;

                if (this.enableLogging) {
                    console.warn(`${context} failed on attempt ${attempt}:`, error.message);
                }

                if (attempt === maxRetries) {
                    break;
                }

                // Exponential backoff with jitter
                const delay = this.retryDelay * Math.pow(2, attempt - 1) + Math.random() * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        throw lastError;
    }

    /**
     * Circuit breaker pattern for external services
     */
    createCircuitBreaker(fn, options = {}) {
        const threshold = options.threshold || 5;
        const timeout = options.timeout || 60000; // 1 minute
        const resetTimeout = options.resetTimeout || 300000; // 5 minutes

        let failureCount = 0;
        let lastFailureTime = null;
        let state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN

        return async (...args) => {
            if (state === 'OPEN') {
                if (Date.now() - lastFailureTime > resetTimeout) {
                    state = 'HALF_OPEN';
                    if (this.enableLogging) {
                        console.log('Circuit breaker transitioning to HALF_OPEN');
                    }
                } else {
                    throw new Error('Circuit breaker is OPEN - service temporarily unavailable');
                }
            }

            try {
                const result = await Promise.race([
                    fn.apply(this, args),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Operation timeout')), timeout)
                    )
                ]);

                if (state === 'HALF_OPEN') {
                    state = 'CLOSED';
                    failureCount = 0;
                    if (this.enableLogging) {
                        console.log('Circuit breaker reset to CLOSED');
                    }
                }

                return result;

            } catch (error) {
                failureCount++;
                lastFailureTime = Date.now();

                if (failureCount >= threshold) {
                    state = 'OPEN';
                    if (this.enableLogging) {
                        console.log(`Circuit breaker tripped - state: OPEN (failures: ${failureCount})`);
                    }
                }

                throw error;
            }
        };
    }

    /**
     * Graceful degradation wrapper
     */
    async withFallback(primaryFn, fallbackFn, context = 'operation') {
        try {
            return await primaryFn();
        } catch (primaryError) {
            if (this.enableLogging) {
                console.warn(`Primary ${context} failed, attempting fallback:`, primaryError.message);
            }

            if (!this.fallbackEnabled) {
                throw primaryError;
            }

            try {
                const result = await fallbackFn();
                if (this.enableLogging) {
                    console.log(`Fallback ${context} succeeded`);
                }
                return result;
            } catch (fallbackError) {
                if (this.enableLogging) {
                    console.error(`Both primary and fallback ${context} failed:`, {
                        primary: primaryError.message,
                        fallback: fallbackError.message
                    });
                }

                // Throw original error with fallback error as context
                primaryError.fallbackError = fallbackError;
                throw primaryError;
            }
        }
    }

    /**
     * Safe JSON parsing with fallback
     */
    parseJSON(jsonString, fallback = null) {
        try {
            return JSON.parse(jsonString);
        } catch (error) {
            if (this.enableLogging) {
                console.warn('JSON parsing failed, using fallback:', error.message);
            }
            return fallback;
        }
    }

    /**
     * Safe property access with default values
     */
    safeGet(obj, path, defaultValue = null) {
        try {
            return path.split('.').reduce((current, key) => {
                return (current && current[key] !== undefined) ? current[key] : defaultValue;
            }, obj);
        } catch (error) {
            if (this.enableLogging) {
                console.warn(`Safe property access failed for path "${path}":`, error.message);
            }
            return defaultValue;
        }
    }

    /**
     * Rate limiter to prevent overwhelming external services
     */
    createRateLimiter(maxCalls, windowMs) {
        const calls = [];

        return (fn) => {
            return async (...args) => {
                const now = Date.now();

                // Remove calls outside the window
                while (calls.length > 0 && calls[0] <= now - windowMs) {
                    calls.shift();
                }

                if (calls.length >= maxCalls) {
                    const waitTime = calls[0] + windowMs - now;
                    if (this.enableLogging) {
                        console.warn(`Rate limit exceeded, waiting ${waitTime}ms`);
                    }
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    return this.createRateLimiter(maxCalls, windowMs)(fn)(...args);
                }

                calls.push(now);
                return await fn.apply(this, args);
            };
        };
    }

    /**
     * Health check utility
     */
    async healthCheck(checks = []) {
        const results = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            checks: {}
        };

        let allHealthy = true;

        for (const check of checks) {
            const startTime = Date.now();
            try {
                const result = await Promise.race([
                    check.fn(),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Health check timeout')), 5000)
                    )
                ]);

                results.checks[check.name] = {
                    status: 'healthy',
                    responseTime: Date.now() - startTime,
                    result
                };

            } catch (error) {
                results.checks[check.name] = {
                    status: 'unhealthy',
                    responseTime: Date.now() - startTime,
                    error: error.message
                };
                allHealthy = false;
            }
        }

        results.status = allHealthy ? 'healthy' : 'degraded';
        return results;
    }

    /**
     * Bulk operation with partial failure handling
     */
    async bulkOperation(items, operation, options = {}) {
        const maxConcurrent = options.maxConcurrent || 5;
        const continueOnError = options.continueOnError !== false;

        const results = {
            successful: [],
            failed: [],
            total: items.length
        };

        const semaphore = new Array(maxConcurrent).fill(null);
        let index = 0;

        const processItem = async (item, itemIndex) => {
            try {
                const result = await operation(item, itemIndex);
                results.successful.push({ index: itemIndex, item, result });
            } catch (error) {
                results.failed.push({ index: itemIndex, item, error: error.message });

                if (!continueOnError) {
                    throw error;
                }

                if (this.enableLogging) {
                    console.warn(`Bulk operation failed for item ${itemIndex}:`, error.message);
                }
            }
        };

        const worker = async () => {
            while (index < items.length) {
                const currentIndex = index++;
                if (currentIndex < items.length) {
                    await processItem(items[currentIndex], currentIndex);
                }
            }
        };

        await Promise.all(semaphore.map(() => worker()));

        if (this.enableLogging) {
            console.log(`Bulk operation completed: ${results.successful.length} successful, ${results.failed.length} failed`);
        }

        return results;
    }
}

module.exports = { ErrorHandler };
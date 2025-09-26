// Mock Chart.js
export default class Chart {
  constructor(ctx, config) {
    this.ctx = ctx;
    this.config = config;
    this.data = config.data || { labels: [], datasets: [] };
    this.options = config.options || {};
  }
  
  update(mode) {
    // Mock update
  }
  
  destroy() {
    // Mock destroy
  }
  
  static register() {
    // Mock register
  }
}
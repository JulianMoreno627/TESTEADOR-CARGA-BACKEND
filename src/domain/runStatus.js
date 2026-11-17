export const RunStatus = Object.freeze({
  RUNNING: 'running',
  COMPLETED: 'completed',
  STOPPED: 'stopped',
  FAILED: 'failed',
});

export const isFinished = (status) => status !== RunStatus.RUNNING;

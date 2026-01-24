let loggingEnabled = false;

export const setLoggingEnabled = (enabled) => {
  loggingEnabled = enabled;
};

export const log = (...args) => {
  if (!loggingEnabled) {
    return;
  }

  console.log(...args);
};

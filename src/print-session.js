let job = null;

export function beginPrint(value) {
  job = value;
}

export function currentPrint() {
  return job;
}

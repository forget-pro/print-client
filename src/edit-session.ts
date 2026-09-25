import { ref } from "vue";

type EditRequest = {
  paths?: string[];
  path?: string;
  index?: number;
  id?: string;
  source?: string;
};

type EditResult = {
  index?: number;
  id?: string;
  source?: string;
  path: string;
  name?: string;
};

let request: EditRequest | null = null;
let result: EditResult | null = null;

export const editVersion = ref(0);
export const sessionReady = ref(false);

export function markSessionReady() {
  sessionReady.value = true;
}

export function beginEdit(value: EditRequest) {
  request = value;
  result = null;
  editVersion.value += 1;
}

export function currentEdit() {
  return request;
}

export function finishEdit(value: { path: string; name?: string }) {
  if (!request) return;
  result = {
    index: request.index,
    id: request.id,
    source: request.source,
    path: value.path,
    name: value.name,
  };
  request = null;
}

export function takeEditResult() {
  const saved = result;
  result = null;
  return saved;
}

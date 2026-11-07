import {Worker, isMainThread as mainthread, parentPort as parent, workerData as data} from "node:worker_threads";
import {capture, restore} from "./snapshot.mjs";
import {exporthandoff} from "./transfer.mjs";

export function background(task, options) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), {workerData: {task, options}});
    worker.once("message", value => value.error ? reject(new Error(value.error)) : resolve(value.result));
    worker.once("error", reject);
    worker.once("exit", code => {if (code) reject(new Error(`Background operation stopped: ${code}`))});
  });
}

if (!mainthread) {
  try {
    const actions = {capture, restore, exporthandoff};
    if (!actions[data.task]) throw new Error("Unknown background operation");
    parent.postMessage({result: actions[data.task](data.options)});
  } catch (error) {parent.postMessage({error: error.message})}
}

import { app, BrowserWindow, shell, ipcMain } from "electron";
import { execSync, spawnSync, exec } from "child_process";
function checkPort(port: any) {
  return new Promise((resolve, reject) => {
    exec(`netstat -ano | findstr :${port}`, (error, stdout, stderr) => {
      if (error) {
        // 处理找不到结果的情况
        if (error.code === 1) {
          resolve(false); // 没有找到占用端口的进程
        } else {
          reject(`Error executing command: ${error.message}`);
        }
        return;
      }
      if (stderr) {
        reject(`Command error output: ${stderr}`);
        return;
      }
      resolve({ result: stdout.trim() !== "", stdout }); // 找到结果则返回 true，否则返回 false
    });
  });
}
function findProcessNameByPort(stdout: string) {
  return new Promise((resolve, reject) => {
    const processId = stdout.trim().split(/\s+/).pop();
    exec(
      `tasklist /fi "PID eq ${processId}" /fo csv /nh`,
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        // stdout 格式类似于："chrome.exe","5160","Console","1","23,996 K"
        const processName = stdout.trim().split(",")[0].replace(/"/g, "");
        resolve(processName);
      }
    );
  });
}

export const wcf_isRun = async (port = 10086) => {
  const res: any = await checkPort(port);
  if (res) {
    const name = await findProcessNameByPort(res.stdout);
    return res.result && name == "WeChat.exe";
  }
  return false;
};

export function Wcf(win: BrowserWindow) {
  ipcMain.handle("wcf_start", (e, data) => {
    console.log(data, 5);
    return "wcf_start_yes";
  });
}

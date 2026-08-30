# dsh-vault

持久化「凭据保险库」插件 for [DeepSeek Harness](https://github.com/deepseek-ai) (DSH)。

在 **设置 → 凭据** 板块用一张可折叠的列表集中管理常用凭据：API Token、服务器登录、网站账号、GitHub PAT……每类填一次，之后所有会话都能直接取用。机密字段存入 DSH 凭据库（不落明文、界面不回显），非机密字段存入 settings。

## 功能

- **一个面板管理所有凭据**：列表式条目，可折叠/展开，收起时显示「已配置 n/m」摘要
- **机密与配置分离**：Token/密码 → DSH 凭据库；IP、网址等非机密 → `dsh-vault` settings 命名空间
- **模型可直接取用**：注册 `vault_status` / `vault_get` 两个工具，agent 在任务中自行解析密钥（如调 Cloudflare API、SSH 登录服务器）
- **不回显**：机密字段在界面只显示「已配置 / 未配置」，输入新值即覆盖
- **5 种内置类别**，类型下拉即选即换：

| 类别 | 字段（粗体为机密） | 凭据库 ref 示例 |
|---|---|---|
| Token | **token** | `VAULT_<ID>_TOKEN` |
| 服务器 | ip、user、port、publicHost、sshAlias、note、**password** | `VAULT_SERVER_PASSWORD` |
| 网站 | url、user、**password** | `VAULT_<ID>_PASSWORD` |
| GitHub | user、**token** | `VAULT_GITHUB_TOKEN` |
| （自定义） | 在 `KINDS` 里加一组字段即可 | `VAULT_<ID>_<FIELD>` |

## 安装

```sh
dsh plugin add <本仓库 URL 或本地路径>
```

本地开发安装示例：

```sh
dsh plugin add file:./dsh-vault
```

重启 DSH 后，设置里出现「凭据」板块。

## 使用

1. 设置 → 凭据 → 「+ 添加凭据」，选类型、填字段（改动在输入框失焦时保存）
2. 让模型干活时它自己会调工具：
   - `vault_status` — 列出条目与各机密字段是否已配置（只有布尔，没有值）
   - `vault_get` — 按 `id` + 字段名取回某个密钥值（如 `id=github field=token`），模型用完即弃，不会复述

## 数据存放

| 数据 | 位置 |
|---|---|
| 条目结构、非机密字段 | `~/.dsh/settings.yaml` 的 `dsh-vault` 命名空间 |
| 机密字段 | DSH 凭据库（`~/.dsh/.credentials.yaml`，0600） |

卸载插件不会删除凭据库中的密钥；如需清除，在条目里点「清除已存密钥」。

## 安全模型

- 机密只在写入时经过界面，之后任何界面都不回显
- `vault_get` 的返回值只出现在当次工具调用里，工具卡渲染层只显示「Resolved …」
- 每个机密的 ref 形如 `VAULT_<条目ID>_<字段名>`，与条目一一对应

## 扩展新类别

改两处 `KINDS`（Host 半 `lib/index.js` 的 `secretFields`，Client 半 `lib/client.js` 的字段定义），重启即可。字段 key 会参与凭据库 ref 派生（大写、非字母数字转 `_`）。

## License

[MIT](./LICENSE)

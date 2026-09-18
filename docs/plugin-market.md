# 插件市场（内部试用）

插件市场只展示已经合并到主仓库 `catalog/plugins.json` 的官方 DeepSeek 内核插件。普通用户不需要登录 GitHub；插件作者通过 Pull Request 提交，维护者审核并合并后，Windows 和 macOS 客户端才会显示该插件。

## 插件包格式

Release 资产必须是一个 JSON 文件，文件名以 `.plugin.json` 结尾。包结构如下：

```json
{
  "format": 1,
  "id": "example-plugin",
  "version": "1.0.0",
  "entry": "main.mjs",
  "permissions": ["network"],
  "files": {
    "main.mjs": "export function apply(ctx) {}",
    "LICENSE.md": "MIT"
  }
}
```

包必须自包含、固定版本、包含许可证文件和依赖文件。不能包含 `package.json`、安装脚本、动态 import、`eval`、`require`、子进程调用或未声明的文件/网络权限。插件在官方 DeepSeek 内核进程中运行，权限字段用于审核和安装提示，不提供操作系统级沙箱。

## 提交流程

1. 在 `catalog/plugins/<plugin-id>/plugin.json` 添加 manifest，并在 `catalog/plugins.json` 注册同一个版本。
2. 将固定版本的 `.plugin.json` 上传到 GitHub Release，计算 SHA-256，并填写完整 Git commit、依赖和许可证信息。
3. 提交 Pull Request。`validate-plugin-catalog` 会检查字段、版本、来源、校验值、依赖和静态能力。
4. 维护者人工审核代码和权限后合并。只有合并后的目录才会被客户端读取。

安装、停用、更新和卸载都写入用户目录，不修改应用安装目录；更新失败会恢复上一版本。安装或更新后需要用户确认重启本地服务。

# Contributing to Aura Tab

感谢您对 Aura Tab 项目的关注！我们欢迎并感激任何形式的贡献。

## 如何贡献

### 报告问题

如果您发现了 bug 或有功能建议，请通过 [GitHub Issues](https://github.com/nil-byte/aura-tab/issues) 提交：

1. 搜索现有 issues，确认问题未被报告
2. 使用清晰的标题描述问题
3. 提供详细的问题描述：
   - 复现步骤
   - 期望行为
   - 实际行为
   - 浏览器版本和操作系统
   - 截图（如适用）

### 提交代码

1. **Fork 仓库**
   ```bash
   git clone https://github.com/nil-byte/aura-tab.git
   cd aura-tab
   ```

2. **创建分支**
   ```bash
   git checkout -b feature/your-feature-name
   # 或
   git checkout -b fix/bug-description
   ```

3. **安装依赖并测试**
   ```bash
   npm install
   npm test
   ```

4. **提交更改**
   我们遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范：
   - `feat:` 新功能
   - `fix:` Bug 修复
   - `docs:` 文档更新
   - `test:` 添加或更新测试
   - `refactor:` 代码重构
   - `perf:` 性能优化
   - `chore:` 构建过程或辅助工具的变动

   ```bash
   git commit -m "feat: add amazing feature"
   ```

5. **推送并创建 Pull Request**
   ```bash
   git push origin feature/your-feature-name
   ```

## 开发指南

### 项目结构

```
scripts/
├── boot/           # 首屏优化
├── domains/        # 功能模块 (DDD 架构)
│   ├── backgrounds/    # 背景系统
│   ├── quicklinks/     # 快速链接
│   ├── settings/       # 设置窗口
│   ├── bookmarks/      # 书签管理
│   ├── photos/         # 照片查看器
│   └── changelog/      # 更新日志
├── platform/       # 平台抽象层
└── shared/         # 共享工具
```

### 代码规范

- 使用 ES6+ 语法
- 优先使用模块化导入/导出
- 添加适当的注释说明复杂逻辑
- 保持代码简洁，避免过度工程化

### 测试

- 所有新功能应包含测试
- 确保所有测试通过后再提交
- 使用 `npm run test:coverage` 检查覆盖率

```bash
# 运行测试
npm test

# 运行测试并生成覆盖率报告
npm run test:coverage

# 监听模式
npm run test:watch
```

### 提交前检查清单

- [ ] 代码遵循项目风格
- [ ] 所有测试通过
- [ ] 新功能有相应测试
- [ ] 文档已更新（如需要）
- [ ] Commit message 符合规范

## 行为准则

- 尊重所有参与者
- 接受建设性批评
- 关注对社区最有利的事情

## 许可证

通过贡献代码，您同意您的贡献将在 [MIT 许可证](LICENSE) 下发布。

---

**English Version**

# Contributing to Aura Tab

Thank you for your interest in Aura Tab! We welcome and appreciate all forms of contributions.

## How to Contribute

### Reporting Issues

If you find a bug or have a feature suggestion, please submit via [GitHub Issues](https://github.com/nil-byte/aura-tab/issues):

1. Search existing issues to ensure it's not already reported
2. Use a clear title to describe the issue
3. Provide detailed description:
   - Steps to reproduce
   - Expected behavior
   - Actual behavior
   - Browser version and OS
   - Screenshots (if applicable)

### Submitting Code

1. **Fork the repository**
   ```bash
   git clone https://github.com/nil-byte/aura-tab.git
   cd aura-tab
   ```

2. **Create a branch**
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/bug-description
   ```

3. **Install dependencies and test**
   ```bash
   npm install
   npm test
   ```

4. **Commit changes**
   We follow [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat:` New feature
   - `fix:` Bug fix
   - `docs:` Documentation changes
   - `test:` Adding or updating tests
   - `refactor:` Code refactoring
   - `perf:` Performance improvements
   - `chore:` Build process or auxiliary tool changes

   ```bash
   git commit -m "feat: add amazing feature"
   ```

5. **Push and create Pull Request**
   ```bash
   git push origin feature/your-feature-name
   ```

## Development Guidelines

### Project Structure

See above Chinese version for structure details.

### Code Standards

- Use ES6+ syntax
- Prefer modular imports/exports
- Add appropriate comments for complex logic
- Keep code simple, avoid over-engineering

### Testing

- All new features should include tests
- Ensure all tests pass before submitting
- Use `npm run test:coverage` to check coverage

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

### Pre-submission Checklist

- [ ] Code follows project style
- [ ] All tests pass
- [ ] New features have corresponding tests
- [ ] Documentation updated (if needed)
- [ ] Commit message follows conventions

## Code of Conduct

- Respect all participants
- Accept constructive criticism
- Focus on what's best for the community

## License

By contributing code, you agree that your contributions will be released under the [MIT License](LICENSE).

# Changelog

All notable changes to p-queue-x will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-06-16

### Added
- Zero-dependency promise-based concurrency-limited task queue
- Concurrency control (limit simultaneous async tasks)
- Priority support (higher priority tasks run first, binary search insertion)
- Per-task timeout with automatic rejection
- Pause / resume functionality
- Event hooks (add, next, complete, error, idle, empty, pause, resume)
- Dynamic concurrency adjustment
- `onIdle()`, `onEmpty()`, `onSizeLessThan()` lifecycle methods
- `addAll()` for adding multiple tasks at once
- CLI tool with demo, benchmark, and priority test commands
- TypeScript support with strict mode
- ESM and CommonJS dual exports
- Full type definitions (.d.ts)

### Features
- **Zero dependencies**: No external dependencies, ~12KB bundle size
- **Performance**: O(1) operations for add/remove, O(log n) binary search for priority
- **Type safety**: Full TypeScript support with exported types
- **Flexible**: Supports both ESM and CommonJS modules
- **Well-tested**: 48 test cases covering all functionality

### Documentation
- Comprehensive README with quick start guide
- API documentation for all methods and options
- Real-world examples: rate-limited API crawler, concurrency control, priority demo
- CLI help and usage examples

[1.0.0]: https://github.com/sulthonzh/p-queue-x/releases/tag/v1.0.0
# tests 目录说明

按与 `tools/` 对应的职责划分子目录，便于维护：

```
tests/
├── crawl/            # ↔ tools/crawl/
├── patent_reader/    # ↔ tools/patent_reader/
├── shared/           # ↔ tools/shared/
├── fixtures/         # 共享样例（如 patent_reader_sample.txt）
└── README.md
```

| 子目录 | 对应工具 | 内容 |
|--------|----------|------|
| `crawl/` | `tools/crawl/` | 国知局公布公告检索（Playwright / 类型过滤） |
| `patent_reader/` | `tools/patent_reader/` | 专利通俗解读、Schema 入库、附图与权要等 |
| `shared/` | `tools/shared/` | Markdown / Word / 公式渲染等公用脚本 |
| `fixtures/` | — | 共享样例输入（如 `patent_reader_sample.txt`） |

各子目录含 `__init__.py`，便于 `unittest discover` 递归导入。

## 运行

在**仓库根目录**：

```bash
# 全部（须加 -t .，以便包路径从仓库根解析）
python -m unittest discover -s tests -t . -p "test_*.py"

# 分组
python -m unittest discover -s tests/crawl -t . -p "test_*.py"
python -m unittest discover -s tests/patent_reader -t . -p "test_*.py"
python -m unittest discover -s tests/shared -t . -p "test_*.py"

# 单文件
python tests/crawl/test_cnipa_epub_crawler.py
python tests/patent_reader/test_schema_vault.py
```

联调国知局实网（非 unittest 用例，脚本入口）：

```bash
python tests/crawl/test_cnipa_epub_chain.py [关键词]
```

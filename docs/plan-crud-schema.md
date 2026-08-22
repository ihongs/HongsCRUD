# schema 接口规范

- 20260819：`xxx.schema` 返回标准 JSON Schema（draft 2020-12），供前端渲染表单及 AI 编排。

## 请求

```json
{
    "method": "xxx.schema",
    "params": {
        "cols": { "abc": 1, "def": 1 } // 待返回的列，投影，可选，默认所有；亦可 { "abc": 0 } 排除
    }
}
```

## 返回

`result` 本身即 JSON Schema 根节点：

```json
{
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "title": "对应 Schema 扩展的 title",
    "description": "对应 Schema 扩展的 description",
    "properties": {
        "abc": {
            "type": "string", // 对应 type: String
            "title": "Abc", // 对应 title
            "description": "abc xxxx", // 对应 description
            "pattern": "^[a-zA-Z0-9_]+$", // 对应 match 正则字符串
            "minLength": 4, // 对应 minlength
            "maxLength": 20, // 对应 maxlength
            "readOnly": true, // 对应 assign: false
            "writeOnly": true, // 对应 select: false
            "x-immutable": true, // 对应 immutable: true
            "x-opt": "value" // 对应 options: { opt: 'value' }，每个 key 加 x- 前缀
        },
        "def": {
            "type": "number", // 对应 type: Number
            "title": "Def",
            "description": "def xxxx",
            "default": 0, // 对应 default，函数型默认值不透出
            "minimum": 0, // 对应 min
            "maximum": 1000, // 对应 max
            "x-countable": true // 对应 countable: true，可被 counts() 统计
        },
        "sub": {
            "type": "object", // 对应 type: SubDocument
            "properties": {
                "xyz": {
                    "type": "string"
                }
            },
            "required": [
                "xyz"
            ]
        },
        "subs": {
            "type": "array", // 对应 type: [SubDocument]
            "items": {
                "type": "object",
                "properties": {
                    "xyz": {
                        "type": "string"
                    }
                }
            }
        },
        "tags": {
            "type": "array", // 对应 type: [String]
            "items": {
                "type": "string"
            }
        },
        "opts": {
            "type": "object", // 对应 type: Map, of: Number
            "additionalProperties": {
                "type": "number"
            }
        },
        "status": {
            "type": "string",
            "title": "Status",
            "x-ref": { // 对应自定义 refData（DataRef）
                "list": "status", // 关联到 x-datalist 中的 status 数据
                "value": "value", // 关联到 x-datalist 中的 status 数据的 value 字段，默认为 value
                "title": "title" // 关联到 x-datalist 中的 status 数据的 title 字段，默认为 title
            }
        },
        "yyyId": {
            "type": "string",
            "format": "object-id", // 对应 type: ObjectId
            "title": "Yyy Join Data",
            "x-ref": {
                "method": "xxx.yyy", // 有 method 则远程取数，调 callFunc(method, params)
                "params": {
                    "find": {
                        "status": "active"
                    }
                },
                "list": "list", // 返回的 list 键，默认为 list
                "value": "_id", // 关联到 xxx 数据的 _id 字段
                "title": "name" // 关联到 xxx 数据的 name 字段
            }
        }
    },
    "required": [ // required: true 的字段汇总到上级 object 节点，字段节点自身不带 required
        "abc",
        "def"
    ],
    "x-datalist": { // 对应 Schema 扩展的 dataList，仅输出被 refData.list 引用到的列表
        "status": [
            {
                "value": "active",
                "title": "Active"
            },
            {
                "value": "inactive",
                "title": "Inactive"
            }
        ]
    }
}
```

## 补充规则

- `select: false` 且 `assign: false` 的字段既不可读又不可写，直接跳过，不透出。
- `timestamps` 产生的 `createdAt` / `updatedAt` 强制标记 `readOnly: true`。
- 启用 `softDelete` 后自动补的 `isDeleted` / `deletedAt` 因 `assign: false` + `select: false` 不会透出。
- 字段名不做改写，`_id` 原样输出。
- `Decimal128` 映射为 `type: "number"`；`Date` 为 `type: "string", format: "date-time"`；`ObjectId` 为 `type: "string", format: "object-id"`。
- `minlength` / `maxlength` 按 type 分别映射为 `minLength`/`maxLength`、`minItems`/`maxItems`、`minProperties`/`maxProperties`。
- `cols` 只过滤顶层字段。

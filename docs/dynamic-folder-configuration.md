# Dynamic folder configuration

Filer keeps folder visibility in one canonical settings book. The underlying
ONE object is a `TargetSettings` version addressed to the running instance with
module ID `filer.folders`. The filesystem exposes that state at:

- `/ONE/System/settings/Filer/folders.json` — writable configuration
- `/ONE/System/settings/Filer/status.json` — read-only effective status

`folders.json` accepts these keys and modes:

```json
{
  "files": "auto",
  "fotos": "auto",
  "health.flexibel": "auto"
}
```

Each value is `auto`, `visible`, or `hidden`. Writes use the same revision-bound
managed-file protocol as other editable Filer documents, so a stale Finder write
cannot overwrite a newer settings version.

## Automatic visibility

| Setting | Filesystem path | `auto` rule |
| --- | --- | --- |
| `files` | `/Files` | Visible by default |
| `fotos` | `/Fotos` | Visible when a verified Fotos share has content |
| `health.flexibel` | `/Gesundheit/Flexibel` | Visible when a verified Flexibel publication exists |

`visible` forces the projection to mount even when it is empty. `hidden` keeps
it out of the root regardless of content. Filer derives availability only from
durable, verified shares and publication roots; a transient network connection
does not change the filesystem layout.

The parent `/Gesundheit` is a category mount. It appears while Flexibel is
effective and contains the product-owned `Flexibel` child. Future health products
can add siblings without taking over the category name.

## Removing a folder

Deleting an empty configurable root changes its setting to `hidden`. Deleting
`/Gesundheit/Flexibel` has the same effect. A populated folder returns
`ENOTEMPTY`; Filer never interprets removal of a projection as permission to
delete imported data or shared publications. Edit `folders.json` to restore a
hidden folder or return it to `auto` mode.

## Endpoint boundary

Filer imports user files through `/Files`. It does not publish or mount a
top-level `/objects` folder. `/objects` remains a vger.headless sharing endpoint,
while Filer's read-only raw object browser is available at
`/ONE/System/objects`.

Settings changes, file imports, and verified publication updates reconcile the
mount registry and invalidate the native working set through events. No polling
or ambient object-store scan is involved.

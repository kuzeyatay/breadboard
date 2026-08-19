# showing_images

When the user asks to see images, photos, pictures or logos of something, call
`image_search` and show the results — do not describe images from memory, and
do not paste bare links or markdown images instead of calling the tool.

Render what the tool returns by copying its `display` object into a fenced
code block whose info string is `image-results`:

```image-results
{"query":"...","items":[...]}
```

The chat draws that block as a clickable image grid with a full-screen viewer,
so emit it exactly once per search and never repeat the same links in prose.
A short lead-in line before the block (for example naming the subject you
resolved an ambiguous query to) is welcome; a caption per image is not needed.
If the tool reports itself unconfigured or unavailable, say so plainly and
stop — never fabricate image links.

When the user asks for more images, call `image_search` again with
`startIndex` set to the previous result's `nextPageStartIndex` and render the
new results the same way.


<script setup>
import { ref, watch } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import { StarterKit } from '@tiptap/starter-kit'
import { Image } from '@tiptap/extension-image'
import { TableKit } from '@tiptap/extension-table'

import { htmlToTiptap } from '@/utils/htmlToTiptap'

const props = defineProps({
  html: {
    type: String,
    default: ''
  }
})

const error = ref('')

const emptyDoc = () => ({
  type: 'doc',
  content: [{ type: 'paragraph' }]
})

const editor = useEditor({
  extensions: [
    StarterKit,
    Image.configure({
      inline: false,
      allowBase64: false
    }),
    TableKit
  ],
  content: emptyDoc(),
  editable: false
})

// 게시물 HTML이 변경될 때 자동 반영
watch(
  [() => props.html, editor],
  ([html, instance]) => {
    if (!instance) return

    try {
      error.value = ''

      const json = htmlToTiptap(html || '')

      instance.commands.setContent(json, {
        emitUpdate: false,
        errorOnInvalidContent: true
      })
    } catch (e) {
      console.error('게시물 변환 실패:', e)
      error.value = '본문을 표시할 수 없습니다.'

      instance.commands.setContent(emptyDoc(), {
        emitUpdate: false
      })
    }
  },
  { immediate: true }
)
</script>

<template>
  <div class="board-viewer">
    <p v-if="error">{{ error }}</p>
    <EditorContent v-else :editor="editor" />
  </div>
</template>

<style scoped>
.board-viewer {
  width: 100%;
  overflow-x: auto;
}

.board-viewer :deep(.tiptap) {
  outline: none;
  line-height: 1.7;
  overflow-wrap: anywhere;
}

.board-viewer :deep(img) {
  max-width: 100%;
  height: auto;
}

.board-viewer :deep(table) {
  border-collapse: collapse;
  width: max-content;
  min-width: 100%;
}

.board-viewer :deep(td),
.board-viewer :deep(th) {
  border: 1px solid #ccc;
  padding: 8px;
}

.board-viewer :deep(th) {
  background: #f5f5f5;
}

.board-viewer :deep(ul) {
  list-style: disc;
  padding-left: 24px;
}

.board-viewer :deep(ol) {
  list-style: decimal;
  padding-left: 24px;
}
</style>

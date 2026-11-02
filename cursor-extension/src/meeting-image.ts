import * as fs from 'fs'
import * as path from 'path'
import { tmpdir } from 'os'

// Meeting images must be main-owned temporary PNGs, never arbitrary renderer paths.
export function validateMeetingImage(value: unknown, vision: boolean): void {
  if (value === undefined || value === null) return
  if (!vision) throw new Error('Vision đang tắt; chọn model hỗ trợ ảnh và bật Vision Supported.')
  if (typeof value !== 'string' || value.length > 4096) throw new Error('Invalid meeting image')
  const parent = path.dirname(value)
  if (path.basename(value) !== 'screen.png' || !/^meeting-image-[a-zA-Z0-9]+$/.test(path.basename(parent))
    || fs.realpathSync(path.dirname(parent)) !== fs.realpathSync(tmpdir())
    || fs.lstatSync(parent).isSymbolicLink()) throw new Error('Invalid meeting image location')
  const stat = fs.lstatSync(value)
  if (!stat.isFile() || stat.size < 8 || stat.size > 8 * 1024 * 1024) throw new Error('Invalid meeting PNG size')
  const fd = fs.openSync(value, 'r')
  try {
    const header = Buffer.alloc(8)
    fs.readSync(fd, header, 0, 8, 0)
    if (header.toString('hex') !== '89504e470d0a1a0a') throw new Error('Invalid meeting PNG')
  } finally { fs.closeSync(fd) }
}

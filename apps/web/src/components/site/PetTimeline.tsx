import Image from 'next/image'
import React from 'react'

import type { TimelineAlignment, TimelineEntry } from '@/lib/pet-timeline'

import { RichText } from './RichText'
import { timelineDateTimeAttr, timelineWhenText } from './timeline-format'

// The Pet timeline block's drawing (src/puck/pet-page-config.tsx): a vertical line with a point per
// update. No hooks and no browser code: it renders on the server for visitors and in the editor.
// "Show all updates" is a <details> element, so it works without JavaScript.
//
// Layout (styles.css, `.timeline-*`): every entry says which side of it the line is on
// (`data-line`). Left: the line on the left of every entry, text left-aligned. Right: the line on the
// right, text right-aligned. Alternate: the line in the centre and entries taking turns, the first on
// the left half (line to its right, text right-aligned), the next on the right half (line to its
// left, text left-aligned); on narrow screens every entry falls back to the left layout.

export type PetTimelineProps = {
  entries: TimelineEntry[]
  align: TimelineAlignment
  /** Entries shown before "Show all updates"; 0 shows them all. */
  limit: number
  showPhotos: boolean
  showTime: boolean
  /** The tag of each entry's title: one level below the block's heading. */
  itemTag: 'h2' | 'h3'
}

function Entry({ entry, line, showPhotos, showTime, itemTag: Tag }: { entry: TimelineEntry; line: 'left' | 'right' } & Pick<PetTimelineProps, 'showPhotos' | 'showTime' | 'itemTag'>) {
  const photos = showPhotos ? entry.photos : []
  return (
    <li className="timeline-entry" data-line={line}>
      <span className="timeline-point" aria-hidden="true" />
      <div className="timeline-content">
        <time className="timeline-date" dateTime={timelineDateTimeAttr(entry, showTime)}>
          {timelineWhenText(entry, showTime)}
        </time>
        <Tag className="item-heading timeline-title">{entry.title}</Tag>
        {/* A rich-text document drawn as React elements (never HTML). */}
        {entry.body ? <RichText doc={entry.body} className="timeline-body" /> : null}
        {photos.length ? (
          <ul className="timeline-photos">
            {photos.map((photo, index) => (
              <li key={`${photo.url}-${index}`}>
                {/* The link opens the full image; its name is the photo's description. */}
                <a href={photo.url} className="timeline-photo">
                  <Image src={photo.thumbnailUrl || photo.url} alt={photo.alt} width={160} height={160} sizes="(max-width: 480px) 30vw, 120px" />
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  )
}

export function PetTimeline({ entries, align, limit, showPhotos, showTime, itemTag }: PetTimelineProps) {
  const lineOf = (index: number): 'left' | 'right' => (align === 'right' ? 'right' : align === 'alternate' ? (index % 2 === 0 ? 'right' : 'left') : 'left')
  const shown = limit > 0 ? entries.slice(0, limit) : entries
  const rest = limit > 0 ? entries.slice(limit) : []
  const draw = (entry: TimelineEntry, index: number) => (
    <Entry key={entry.id} entry={entry} line={lineOf(index)} showPhotos={showPhotos} showTime={showTime} itemTag={itemTag} />
  )
  return (
    <div className="timeline" data-align={align}>
      <ol className="timeline-list">{shown.map((entry, index) => draw(entry, index))}</ol>
      {rest.length ? (
        <details className="timeline-more">
          <summary className="timeline-more-toggle">
            <span className="timeline-more-closed">
              Show all updates ({rest.length} more)
            </span>
            <span className="timeline-more-open">Show fewer updates</span>
          </summary>
          <ol className="timeline-list">{rest.map((entry, index) => draw(entry, shown.length + index))}</ol>
        </details>
      ) : null}
    </div>
  )
}

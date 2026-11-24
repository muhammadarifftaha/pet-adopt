import { Badge } from '@pet-adopt/ui/components/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pet-adopt/ui/components/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@pet-adopt/ui/components/table'
import Link from 'next/link'

import { listForms } from '../server'
import { NewFormButton } from './NewFormButton'
import { editHref, responsesHref } from './paths'

const when = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' })

// The form builder's home: every form with its responses, and "New form".
export async function FormsList() {
  const forms = await listForms()
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Forms appear on the site through the page builder&apos;s Form block. Responses are kept here.
        </p>
        <NewFormButton />
      </div>

      {forms.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No forms yet</CardTitle>
            <CardDescription>Make one for adoption applications, volunteer sign-ups or questions, then add it to a page.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Form</TableHead>
                  <TableHead scope="col">Status</TableHead>
                  <TableHead scope="col">Fields</TableHead>
                  <TableHead scope="col">Responses</TableHead>
                  <TableHead scope="col">Last response</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {forms.map((form) => (
                  <TableRow key={form.id}>
                    <TableCell className="font-medium">
                      <Link href={editHref(form.id)} className="underline-offset-4 hover:underline">
                        {form.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={form.isOpen ? 'default' : 'secondary'}>{form.isOpen ? 'Open' : 'Closed'}</Badge>
                    </TableCell>
                    <TableCell>{form.fieldCount}</TableCell>
                    <TableCell>
                      <Link href={responsesHref(form.id)} className="underline-offset-4 hover:underline">
                        {form.responses} {form.responses === 1 ? 'response' : 'responses'}
                      </Link>
                      {form.unread > 0 && (
                        <Badge variant="outline" className="ml-2">
                          {form.unread} new
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{form.lastResponseAt ? when.format(form.lastResponseAt) : 'None yet'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

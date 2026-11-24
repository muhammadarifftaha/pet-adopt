// Where the form builder's screens live in the admin (the plugin's name is part of the URL).
export const BASE = '/admin/plugins/form-builder'
export const editHref = (id: number) => `${BASE}/forms/${id}`
export const responsesHref = (id: number, page?: number) => `${BASE}/forms/${id}/responses${page && page > 1 ? `?page=${page}` : ''}`

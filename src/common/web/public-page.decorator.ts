import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_PAGE = 'isPublicPage';

/** Marks a page route as reachable without a session (the four auth pages only). */
export const PublicPage = () => SetMetadata(IS_PUBLIC_PAGE, true);

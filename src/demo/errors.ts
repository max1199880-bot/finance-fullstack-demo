/** Ошибка с HTTP-кодом: демо-сервер отвечает { error: message } — как сервер прода. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

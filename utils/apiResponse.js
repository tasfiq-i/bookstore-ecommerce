class ApiResponse {
  static success(res, statusCode = 200, message = 'Success', data = null, meta = null) {
    const response = { success: true, message };
    if (data !== null) response.data = data;
    if (meta !== null) response.meta = meta;
    return res.status(statusCode).json(response);
  }

  static error(res, statusCode = 500, message = 'Something went wrong', errors = null) {
    const response = { success: false, message };
    if (errors !== null) response.errors = errors;
    return res.status(statusCode).json(response);
  }
}

module.exports = ApiResponse;
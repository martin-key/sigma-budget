"""Check imports provided by the pinned processing environment."""
def main():
    import fitz
    import xlrd
    import yaml
    import docx
    import pdfplumber
    import py7zr
    print(fitz.VersionBind)

if __name__ == '__main__':
    main()

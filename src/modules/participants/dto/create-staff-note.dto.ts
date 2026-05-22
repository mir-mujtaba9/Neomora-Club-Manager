import { IsNotEmpty, IsString } from 'class-validator';

export class CreateStaffNoteDto {
  @IsString()
  @IsNotEmpty()
  note!: string;
}
